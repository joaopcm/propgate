import { ImageResponse } from "next/og";

export const alt =
  "propgate — domain verification that tells you what is wrong";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#0b0b0d",
        color: "#fafafa",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: 80,
        width: "100%",
      }}
    >
      <div
        style={{
          color: "#a1a1aa",
          display: "flex",
          fontSize: 22,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}
      >
        propgate
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", fontSize: 64, fontWeight: 600 }}>
          What is actually wrong with this domain?
        </div>
        <div style={{ color: "#a1a1aa", display: "flex", fontSize: 28 }}>
          DNS diagnosis with the lookups behind every answer.
        </div>
      </div>
    </div>,
    size
  );
}
