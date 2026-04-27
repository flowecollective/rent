import nodemailer from "nodemailer";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (_transporter) return _transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD env vars are required");
  }
  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    // Fail fast if Gmail rejects auth or the connection hangs.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  return _transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const user = process.env.GMAIL_USER!;
  return getTransporter().sendMail({
    from: `Flowe Collective <${user}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
