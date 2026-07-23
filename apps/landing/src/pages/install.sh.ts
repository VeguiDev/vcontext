import installScript from "../../../../install.sh?raw";

export const prerender = true;

export function GET() {
  return new Response(installScript, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
