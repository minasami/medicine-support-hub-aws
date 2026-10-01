"""Synthetic raster fixtures only; no patient data, network, or AWS calls."""
from __future__ import annotations

import base64
import json
import struct
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app import MAX_IMAGE_BYTES, analyze_and_preprocess, lambda_handler


def synthetic_skewed_page() -> bytes:
    """Create a fictional page with line art and perspective skew in memory."""
    page = np.full((680, 460, 3), 248, dtype=np.uint8)
    cv2.rectangle(page, (18, 18), (441, 661), (25, 25, 25), 3)
    for y, line_width in ((90, 310), (145, 375), (205, 285), (270, 350), (340, 235), (420, 370), (500, 310), (585, 360)):
        cv2.line(page, (52, y), (52 + line_width, y), (40, 40, 40), 3)
    cv2.putText(page, "RX 024", (52, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (10, 10, 10), 2, cv2.LINE_AA)

    canvas = np.full((820, 1000, 3), 72, dtype=np.uint8)
    source = np.array([[0, 0], [459, 0], [459, 679], [0, 679]], dtype=np.float32)
    target = np.array([[270, 75], [735, 135], [680, 755], [185, 695]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(source, target)
    warped = cv2.warpPerspective(page, transform, (1000, 820))
    mask = cv2.warpPerspective(np.full((680, 460), 255, dtype=np.uint8), transform, (1000, 820))
    canvas[mask > 0] = warped[mask > 0]
    ok, encoded = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise RuntimeError("could not make synthetic fixture")
    return encoded.tobytes()


def oversized_png_header(width: int, height: int) -> bytes:
    """A minimal PNG header used to test pixel limits before raster decoding."""
    def chunk(kind: bytes, payload: bytes) -> bytes:
        import zlib
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)


class OpenCv5WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.photo = synthetic_skewed_page()

    def test_rectifies_perspective_skew_and_emits_analysis(self) -> None:
        result = analyze_and_preprocess(self.photo)
        analysis = result["analysis"]
        output_bytes = base64.b64decode(result["preprocessed_image_base64"], validate=True)
        output = cv2.imdecode(np.frombuffer(output_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)

        self.assertTrue(result["ok"])
        self.assertEqual(analysis["opencv_version"].split(".")[0], "5")
        self.assertTrue(analysis["document"]["detected"])
        self.assertTrue(analysis["document"]["processing_applied"])
        self.assertEqual(
            analysis["document"]["transform"],
            "perspective_rectify_clahe_adaptive_threshold",
        )
        self.assertGreater(analysis["document"]["area_ratio"], 0.15)
        self.assertIsNotNone(output)
        self.assertLess(output.shape[1] / output.shape[0], 1.0)
        self.assertNotEqual(output.shape[:2], (820, 1000))

    def test_quality_metrics_flag_blur_and_underexposure(self) -> None:
        decoded = cv2.imdecode(np.frombuffer(self.photo, dtype=np.uint8), cv2.IMREAD_COLOR)
        blurred = cv2.GaussianBlur(decoded, (31, 31), 0)
        dark = np.clip(decoded.astype(np.float32) * 0.12, 0, 255).astype(np.uint8)
        blur_ok, blur_encoded = cv2.imencode(".jpg", blurred)
        dark_ok, dark_encoded = cv2.imencode(".jpg", dark)
        self.assertTrue(blur_ok and dark_ok)

        sharp = analyze_and_preprocess(self.photo)["analysis"]["quality"]
        soft = analyze_and_preprocess(blur_encoded.tobytes())["analysis"]["quality"]
        dim = analyze_and_preprocess(dark_encoded.tobytes())["analysis"]["quality"]
        self.assertLess(soft["sharpness_laplacian_variance"], sharp["sharpness_laplacian_variance"])
        self.assertIn("low_sharpness", soft["warnings"])
        self.assertGreater(dim["underexposed_pixel_ratio"], 0.30)
        self.assertIn("underexposed", dim["warnings"])

    def test_plain_scene_returns_safe_no_boundary_fallback(self) -> None:
        plain = np.full((480, 640, 3), 140, dtype=np.uint8)
        ok, encoded = cv2.imencode(".jpg", plain)
        self.assertTrue(ok)
        result = analyze_and_preprocess(encoded.tobytes())
        document = result["analysis"]["document"]
        self.assertFalse(document["detected"])
        self.assertFalse(document["processing_applied"])
        self.assertEqual(document["transform"], "identity_no_confident_page")
        self.assertIn("document_boundary_not_found", result["analysis"]["quality"]["warnings"])

    def test_image_byte_and_pixel_limits_are_checked(self) -> None:
        with self.assertRaises(ValueError):
            analyze_and_preprocess(b"0" * (MAX_IMAGE_BYTES + 1))
        with self.assertRaises(ValueError):
            analyze_and_preprocess(oversized_png_header(5000, 5000))

    def test_invalid_or_unsupported_image_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            analyze_and_preprocess(b"not an image")
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"></svg>'
        with self.assertRaises(ValueError):
            analyze_and_preprocess(svg)

    def test_handler_rejects_non_post_and_bad_payload_without_echoing_input(self) -> None:
        get_response = lambda_handler({"requestContext": {"http": {"method": "GET"}}}, None)
        self.assertEqual(get_response["statusCode"], 405)
        self.assertEqual(json.loads(get_response["body"])["error"], "method_not_allowed")

        marker = "synthetic-untrusted-marker"
        bad_response = lambda_handler({"body": json.dumps({"image_base64": marker})}, None)
        self.assertEqual(bad_response["statusCode"], 400)
        self.assertNotIn(marker, bad_response["body"])

    def test_handler_processes_synthetic_fixture(self) -> None:
        request = json.dumps({"image_base64": base64.b64encode(self.photo).decode("ascii")})
        response = lambda_handler(
            {"requestContext": {"http": {"method": "POST"}}, "body": request},
            None,
        )
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(body["analysis"]["document"]["processing_applied"])
        self.assertEqual(body["mime_type"], "image/jpeg")
        self.assertIn("no-store", response["headers"]["cache-control"])

    def test_infrastructure_requires_iam_authentication(self) -> None:
        template = (Path(__file__).parent / "template.yaml").read_text(encoding="utf-8")
        self.assertIn("AuthType: AWS_IAM", template)
        self.assertNotIn("AuthType: NONE", template)
        self.assertNotIn("Principal: '*'", template)

    def test_infrastructure_uses_named_bounded_role_and_retained_repository(self) -> None:
        template_path = Path(__file__).parent / "template.yaml"
        template = template_path.read_text(encoding="utf-8")
        bootstrap = (template_path.parent / "ecr-bootstrap.yaml").read_text(encoding="utf-8")
        repository_resource = (
            "WorkerImageRepository:\n"
            "    Type: AWS::ECR::Repository\n"
            "    DeletionPolicy: Retain\n"
            "    Properties:\n"
            "      RepositoryName: opencv-worker-test"
        )

        self.assertIn(repository_resource, template)
        self.assertIn(repository_resource, bootstrap)
        self.assertNotIn("EmptyOnDelete", template + bootstrap)
        self.assertIn("RoleName: opencv-worker-test-exec", template)
        self.assertIn("Service: lambda.amazonaws.com", template)
        self.assertIn(
            "PermissionsBoundary: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:policy/opencv-worker-test-lambda-boundary",
            template,
        )
        self.assertIn("Role: !GetAtt WorkerExecutionRole.Arn", template)
        self.assertIn("FunctionName: opencv-worker-test", template)
        self.assertIn("Action: logs:CreateLogGroup", template)
        self.assertIn("- logs:CreateLogStream", template)
        self.assertIn("- logs:PutLogEvents", template)


if __name__ == "__main__":
    unittest.main()
