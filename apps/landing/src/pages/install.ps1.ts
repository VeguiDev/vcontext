import installScript from "../../../../install.ps1?raw";

export const prerender = true;

export function GET() {
  return new Response(installScript, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
