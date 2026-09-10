import { execFile } from "node:child_process";

export function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, opts, (error, stdout, stderr) => {
      if (error) {
        resolve({
          status: error.code === "ETIMEDOUT" ? -1 : (error.status ?? -1),
          stdout: stdout || "",
          stderr: stderr || error.message,
          error,
        });
      } else {
        resolve({ status: 0, stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
}
