import { createInstallScreenshot } from "../install-screenshot";

export const runtime = "edge";

export function GET() {
  return createInstallScreenshot("narrow");
}
