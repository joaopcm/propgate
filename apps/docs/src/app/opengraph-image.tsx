import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "propgate docs: DNS diagnosis and API reference";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#0b0b0d",
        color: "#fafafa",
        display: "flex",
        flexDirection: "column",
        fontSize: 64,
        height: "100%",
        justifyContent: "center",
        padding: 80,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 28,
          letterSpacing: 4,
          opacity: 0.6,
        }}
      >
        PROPGATE
      </div>
      <div style={{ display: "flex", fontWeight: 600, marginTop: 16 }}>
        propgate docs
      </div>
      <div
        style={{
          color: "#a1a1aa",
          display: "flex",
          fontSize: 28,
          lineHeight: 1.4,
          marginTop: 24,
          maxWidth: 900,
        }}
      >
        DNS diagnosis taxonomy and API reference. What is wrong, not just that
        something is.
      </div>
    </div>,
    size
  );
}
