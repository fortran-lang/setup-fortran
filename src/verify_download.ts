import * as crypto from "crypto";
import * as fs from "fs";
import * as exec from "@actions/exec";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function computeSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

export async function verifySha256(
  filePath: string,
  expectedSha256: string,
): Promise<void> {
  const expected = expectedSha256.toLowerCase();
  if (!SHA256_PATTERN.test(expected)) {
    throw new Error(`Invalid expected SHA-256 digest: ${expectedSha256}`);
  }

  const actual = await computeSha256(filePath);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 verification failed for ${filePath}. Expected ${expected}, got ${actual}.`,
    );
  }
}

export async function verifyIntelAuthenticode(
  installerPath: string,
): Promise<void> {
  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:SETUP_FORTRAN_INSTALLER",
    "if ($signature.Status -ne 'Valid') { throw \"Invalid Authenticode signature: $($signature.Status)\" }",
    "if ($signature.SignerCertificate.Subject -notmatch 'Intel Corporation') { throw \"Unexpected signer: $($signature.SignerCertificate.Subject)\" }",
  ].join("; ");

  await exec.exec(
    "powershell",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: {
        ...process.env,
        SETUP_FORTRAN_INSTALLER: installerPath,
      },
    },
  );
}
