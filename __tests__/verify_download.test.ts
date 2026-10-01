import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as exec from "@actions/exec";
import {
  computeSha256,
  verifyIntelAuthenticode,
  verifySha256,
} from "../src/verify_download";

jest.mock("@actions/exec");

describe("download verification", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-download-"));
    testFile = path.join(tempDir, "artifact.bin");
    fs.writeFileSync(testFile, "setup-fortran\n");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("computes and accepts a matching SHA-256 digest", async () => {
    const digest = await computeSha256(testFile);
    await expect(verifySha256(testFile, digest)).resolves.toBeUndefined();
  });

  it("rejects a mismatched SHA-256 digest", async () => {
    await expect(verifySha256(testFile, "0".repeat(64))).rejects.toThrow(
      "SHA-256 verification failed",
    );
  });

  it("rejects a malformed expected digest", async () => {
    await expect(verifySha256(testFile, "not-a-digest")).rejects.toThrow(
      "Invalid expected SHA-256 digest",
    );
  });

  it("verifies Intel installers through Authenticode without interpolating the path", async () => {
    await verifyIntelAuthenticode("C:\\Temp\\Intel installer.exe");

    expect(exec.exec).toHaveBeenCalledWith(
      "powershell",
      expect.arrayContaining([
        "-Command",
        expect.stringContaining("Intel Corporation"),
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          SETUP_FORTRAN_INSTALLER: "C:\\Temp\\Intel installer.exe",
        }),
      }),
    );
  });
});
