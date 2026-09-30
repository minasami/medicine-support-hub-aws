"""Stateless OpenCV 5 image preprocessing for an optional AWS Lambda worker.

This handler performs geometric and image-quality analysis only. It does not
read OCR text, identify medicines, diagnose, or persist or log image content.
"""
from __future__ import annotations

import base64
import binascii
import json
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_ENCODED_IMAGE_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4
MAX_IMAGE_PIXELS = 24_000_000
MAX_EDGE = 2400
MIN_DOCUMENT_AREA_RATIO = 0.15


def _validate_raster(image_bytes: bytes) -> None:
    """Check format and dimensions from headers before OpenCV decodes pixels."""
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("unsupported image format")
            width, height = image.size
            if width < 2 or height < 2 or width * height > MAX_IMAGE_PIXELS:
                raise ValueError("image dimensions exceed limit")
            image.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
        raise ValueError("invalid image") from None


def _ordered_quad(points: np.ndarray) -> np.ndarray:
    """Return four corners clockwise in image coordinates, starting top-left."""
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    center = points.mean(axis=0)
    angles = np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0])
    ordered = points[np.argsort(angles)]
    signed_area = float(
        np.sum(
            ordered[:, 0] * np.roll(ordered[:, 1], -1)
            - np.roll(ordered[:, 0], -1) * ordered[:, 1]
        )
    )
    if signed_area < 0:
        ordered = ordered[::-1]
    start = int(np.argmin(ordered.sum(axis=1)))
    return np.roll(ordered, -start, axis=0).astype(np.float32)


def _find_document_quad(gray: np.ndarray) -> tuple[np.ndarray, float] | None:
    """Find the strongest plausible page-like four-corner contour."""
    height, width = gray.shape[:2]
    image_area = float(height * width)
    area_floor = image_area * MIN_DOCUMENT_AREA_RATIO
    softened = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(softened, 45, 135)
    edges = cv2.morphologyEx(
        edges,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), dtype=np.uint8),
        iterations=2,
    )
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    best: tuple[float, np.ndarray, float] | None = None

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:60]:
        contour_area = float(cv2.contourArea(contour))
        if contour_area < area_floor:
            break
        if contour_area >= image_area * 0.995:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        for fraction in (0.015, 0.02, 0.028, 0.04, 0.055):
            approximation = cv2.approxPolyDP(contour, fraction * perimeter, True)
            if len(approximation) != 4 or not cv2.isContourConvex(approximation):
                continue
            quad = _ordered_quad(approximation.reshape(4, 2))
            quad_area = float(cv2.contourArea(quad))
            if quad_area < area_floor or quad_area >= image_area * 0.995:
                continue
            box_area = float(cv2.contourArea(cv2.boxPoints(cv2.minAreaRect(quad))))
            rectangularity = quad_area / box_area if box_area > 0 else 0.0
            if rectangularity < 0.62:
                continue
            side_lengths = [
                float(np.linalg.norm(quad[(index + 1) % 4] - quad[index]))
                for index in range(4)
            ]
            long_side = max(side_lengths)
            short_side = min(side_lengths)
            if short_side < 24 or long_side / short_side > 4.5:
                continue
            area_ratio = quad_area / image_area
            score = quad_area * rectangularity
            if best is None or score > best[0]:
                best = (score, quad, area_ratio)
    if best is None:
        return None
    return best[1], best[2]


def _rectify(image: np.ndarray, quad: np.ndarray) -> np.ndarray:
    ordered = _ordered_quad(quad)
    top_left, top_right, bottom_right, bottom_left = ordered
    target_width = int(
        max(
            np.linalg.norm(bottom_right - bottom_left),
            np.linalg.norm(top_right - top_left),
        )
    )
    target_height = int(
        max(
            np.linalg.norm(top_right - bottom_right),
            np.linalg.norm(top_left - bottom_left),
        )
    )
    if target_width < 32 or target_height < 32:
        raise ValueError("document contour too small")
    scale = min(1.0, MAX_EDGE / max(target_width, target_height))
    target_width = max(32, round(target_width * scale))
    target_height = max(32, round(target_height * scale))
    destination = np.array(
        [
            [0, 0],
            [target_width - 1, 0],
            [target_width - 1, target_height - 1],
            [0, target_height - 1],
        ],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(ordered, destination)
    return cv2.warpPerspective(
        image,
        matrix,
        (target_width, target_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _enhance_for_ocr(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    normalized = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    smallest_dimension = min(normalized.shape[:2])
    block_size = min(35, smallest_dimension if smallest_dimension % 2 else smallest_dimension - 1)
    if block_size < 3:
        return cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)
    threshold = cv2.adaptiveThreshold(
        normalized,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        block_size,
        11,
    )
    return cv2.cvtColor(threshold, cv2.COLOR_GRAY2BGR)


def _resize_to_bound(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, MAX_EDGE / max(height, width))
    if scale >= 1.0:
        return image
    return cv2.resize(
        image,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def _quality_metrics(gray: np.ndarray, original_width: int, original_height: int) -> dict[str, Any]:
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_luma = float(np.mean(gray))
    low_luma_ratio = float(np.mean(gray <= 24))
    overexposed_ratio = float(np.mean(gray >= 250))
    p05, p95 = np.percentile(gray, (5, 95))
    contrast_range = float(p95 - p05)
    warnings: list[str] = []
    if sharpness < 40.0:
        warnings.append("low_sharpness")
    if mean_luma < 55.0 or low_luma_ratio > 0.30:
        warnings.append("underexposed")
    if overexposed_ratio > 0.18:
        warnings.append("high_overexposure")
    if contrast_range < 45.0:
        warnings.append("low_contrast")
    if min(original_width, original_height) < 480:
        warnings.append("low_resolution")
    return {
        "sharpness_laplacian_variance": round(sharpness, 2),
        "mean_luma_0_255": round(mean_luma, 2),
        "underexposed_pixel_ratio": round(low_luma_ratio, 4),
        "overexposed_pixel_ratio": round(overexposed_ratio, 4),
        "contrast_p95_minus_p05": round(contrast_range, 2),
        "warnings": warnings,
    }


def _encode_jpeg(image: np.ndarray) -> bytes:
    for quality in (90, 82, 72):
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok and len(encoded) <= MAX_IMAGE_BYTES:
            return encoded.tobytes()
    raise ValueError("processed image exceeds size limit")


def analyze_and_preprocess(image_bytes: bytes) -> dict[str, Any]:
    """Rectify a confident page and return bounded image-quality metrics."""
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("image must be non-empty and at most 4 MiB")
    _validate_raster(image_bytes)
    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("unsupported or invalid image")

    original_height, original_width = image.shape[:2]
    if original_width * original_height > MAX_IMAGE_PIXELS:
        raise ValueError("image dimensions exceed limit")
    bounded = _resize_to_bound(image)
    gray = cv2.cvtColor(bounded, cv2.COLOR_BGR2GRAY)
    quality = _quality_metrics(gray, original_width, original_height)
    candidate = _find_document_quad(gray)

    if candidate is None:
        processed = bounded
        document = {
            "detected": False,
            "area_ratio": None,
            "processing_applied": False,
            "transform": "identity_no_confident_page",
        }
        quality["warnings"].append("document_boundary_not_found")
    else:
        quad, area_ratio = candidate
        page = _rectify(bounded, quad)
        processed = _enhance_for_ocr(page)
        document = {
            "detected": True,
            "area_ratio": round(area_ratio, 4),
            "processing_applied": True,
            "transform": "perspective_rectify_clahe_adaptive_threshold",
        }

    output_height, output_width = processed.shape[:2]
    output_bytes = _encode_jpeg(processed)
    return {
        "ok": True,
        "mime_type": "image/jpeg",
        "preprocessed_image_base64": base64.b64encode(output_bytes).decode("ascii"),
        "analysis": {
            "opencv_version": cv2.__version__,
            "original_width": int(original_width),
            "original_height": int(original_height),
            "output_width": int(output_width),
            "output_height": int(output_height),
            "document": document,
            "quality": quality,
        },
    }


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body, separators=(",", ":")),
    }


def _request_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if event.get("isBase64Encoded") and isinstance(body, str):
        if len(body) > ((5_700_000 + 2) // 3) * 4:
            raise ValueError("request body too large")
        try:
            body = base64.b64decode(body, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            raise ValueError("invalid request body") from None
    if isinstance(body, dict):
        return body
    if not isinstance(body, str) or len(body) > 5_700_000:
        raise ValueError("invalid request body")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        raise ValueError("invalid request body") from None
    if not isinstance(parsed, dict):
        raise ValueError("invalid request body")
    return parsed


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Handle a Lambda Function URL request; AWS_IAM is enforced by Lambda."""
    method = (
        (event.get("requestContext") or {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "POST"
    )
    if str(method).upper() != "POST":
        return _response(405, {"ok": False, "error": "method_not_allowed"})
    try:
        body = _request_body(event)
        image_base64 = body.get("image_base64")
        if not isinstance(image_base64, str) or not image_base64:
            raise ValueError("image_base64 is required")
        if len(image_base64) > MAX_ENCODED_IMAGE_CHARS + 32:
            raise ValueError("image exceeds size limit")
        if image_base64.startswith("data:"):
            image_base64 = image_base64.split(",", 1)[-1]
        image_bytes = base64.b64decode(image_base64, validate=True)
        result = analyze_and_preprocess(image_bytes)
        return _response(200, result)
    except (ValueError, binascii.Error):
        return _response(400, {"ok": False, "error": "invalid_image"})
    except Exception:
        # Do not log or return exception text; it may contain untrusted image data.
        return _response(500, {"ok": False, "error": "preprocessing_failed"})
