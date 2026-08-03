import sharp from "sharp";
import fs from "node:fs";

const W = 1200;
const H = 630;
const BLUE = "#0052ff";
const GRAY = "#64748b";

// Brand logo supplied by the owner (Desktop image.jpg) — white-background JPG.
const LOGO_SRC = "C:/Users/onder/OneDrive/Desktop/image.jpg";
fs.copyFileSync(LOGO_SRC, "public/logo.jpg");

const logoSize = 460;
const lx = Math.round((W - logoSize) / 2);
const ly = Math.round(310 - logoSize / 2 - 60);

const logo = sharp(LOGO_SRC)
  .resize(logoSize, logoSize, { fit: "contain", background: "#ffffff" });
const logoBuf = await logo.png().toBuffer();

// White card + wordmark + subtitle, all in one transparent SVG.
const svgCard = Buffer.from(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
     <rect x="${lx - 30}" y="${ly - 30}" width="${logoSize + 60}" height="${logoSize + 60}"
           rx="36" fill="#ffffff" stroke="${BLUE}" stroke-width="6"/>
     <text x="600" y="${ly + logoSize + 85}" text-anchor="middle"
           font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
           font-size="66" font-weight="800" fill="${BLUE}" letter-spacing="1">
       BaseBoard
     </text>
     <text x="600" y="${ly + logoSize + 128}" text-anchor="middle"
           font-family="'Segoe UI', Arial, sans-serif"
           font-size="26" font-weight="600" fill="${GRAY}" letter-spacing="6">
       9,998,244 PIXELS · ON BASE
     </text>
   </svg>`,
);
const card = await sharp(svgCard).png().toBuffer();

const final = await sharp({ create: { width: W, height: H, channels: 3, background: "#f4f6fb" } })
  .composite([{ input: card, gravity: "north" }, { input: logoBuf, left: lx, top: ly }])
  .png()
  .toFile("public/og.png");

console.log("wrote public/og.png", final.width + "x" + final.height, final.size, "bytes");
console.log("copied logo to public/logo.jpg");
