import { Client, Account, Databases, Storage, Functions } from "appwrite";

/** Public production project. Safe to ship in the client; not an API key. */
const DEFAULT_ENDPOINT = "https://appwrite.medicinesupport.app/v1";
const DEFAULT_PROJECT_ID = "6a54ac3a00272c02d6e0";

const APPWRITE_ENDPOINT =
  import.meta.env.VITE_APPWRITE_ENDPOINT || DEFAULT_ENDPOINT;
const APPWRITE_PROJECT_ID =
  import.meta.env.VITE_APPWRITE_PROJECT_ID || DEFAULT_PROJECT_ID;

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);
const functions = new Functions(client);

// Safely ping Appwrite backend server to verify SDK setup without breaking TypeScript compiler.
if (typeof window !== "undefined") {
  const pingMethod = (client as any)?.ping;
  if (typeof pingMethod === "function") {
    pingMethod
      .call(client)
      .then(() =>
        console.log(
          `✓ Appwrite SDK successfully connected and verified (${APPWRITE_ENDPOINT}).`,
        ),
      )
      .catch((err: any) =>
        console.warn("ℹ️ Appwrite ping notice:", err?.message || err),
      );
  }
}

export { client, account, databases, storage, functions };
