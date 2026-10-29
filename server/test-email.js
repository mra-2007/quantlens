// Sends one test email using the SMTP settings in .env:  node test-email.js
import "dotenv/config";
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS, ALERT_FROM } = process.env;
console.log(`Using ${SMTP_USER} via ${SMTP_HOST}:${SMTP_PORT} (password ${SMTP_PASS ? SMTP_PASS.length + " chars" : "MISSING"})`);
const t = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
try {
  await t.verify();
  console.log("Login to Gmail: OK");
  const info = await t.sendMail({ from: ALERT_FROM || SMTP_USER, to: SMTP_USER, subject: "QuantLens test email", text: "If you can read this, QuantLens alert emails work." });
  console.log("Email sent:", info.response);
} catch (e) {
  console.log("FAILED:", e.message);
}
