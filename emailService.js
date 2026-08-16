/**
 * EduGuard AI - Email Dispatch Service (Nodemailer)
 */

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.isReady = false;
    this.init();
  }

  async init() {
    // 1. Check if custom SMTP is configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      this.isReady = true;
      console.log(`[EMAIL SERVICE] Configured custom SMTP: ${process.env.SMTP_HOST}`);
      return;
    }

    // 2. Check if Gmail Service is configured
    if (process.env.SMTP_GMAIL_USER && process.env.SMTP_GMAIL_PASS) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_GMAIL_USER,
          pass: process.env.SMTP_GMAIL_PASS
        }
      });
      this.isReady = true;
      console.log(`[EMAIL SERVICE] Configured Gmail Service for: ${process.env.SMTP_GMAIL_USER}`);
      return;
    }

    // 3. Fallback to Ethereal Test SMTP for development testing
    try {
      const testAccount = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      this.isReady = true;
      console.log(`[EMAIL SERVICE] Initialized Test SMTP Transporter (${testAccount.user})`);
    } catch (err) {
      console.warn('[EMAIL SERVICE] Test SMTP initialization warning:', err.message);
    }
  }

  async sendOtpEmail(toEmail, otpCode, candidateName = 'Candidate') {
    if (!this.transporter) {
      await this.init();
    }

    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_GMAIL_USER || '"EduGuard AI Academy" <verify@eduguard.edu>';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; margin: 0; padding: 20px; }
          .email-card { max-width: 540px; margin: 0 auto; background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .header-brand { text-align: center; margin-bottom: 24px; }
          .brand-logo { font-size: 36px; line-height: 1; }
          .brand-title { font-size: 24px; font-weight: 800; color: #ffffff; margin-top: 8px; }
          .subtitle { font-size: 14px; color: #94a3b8; margin-top: 4px; }
          .otp-box { background: rgba(99, 102, 241, 0.12); border: 2px dashed #6366f1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
          .otp-code { font-family: monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #818cf8; }
          .info-text { font-size: 15px; color: #cbd5e1; line-height: 1.6; }
          .expiry-badge { display: inline-block; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; margin-top: 10px; }
          .footer { margin-top: 30px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; text-align: center; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="header-brand">
            <div class="brand-logo">🎓</div>
            <div class="brand-title">EduGuard AI</div>
            <div class="subtitle">AI-Proctored Virtual Classroom & Academic Portal</div>
          </div>

          <p class="info-text">Hello <strong>${candidateName}</strong>,</p>
          <p class="info-text">Thank you for registering. Please use the following 6-digit One-Time Password (OTP) verification code to authenticate your institutional account:</p>

          <div class="otp-box">
            <div class="otp-code">${otpCode}</div>
            <div class="expiry-badge">⏱️ Valid for 10 Minutes</div>
          </div>

          <p class="info-text" style="font-size:13px; color:#94a3b8;">
            If you did not request this verification code, please ignore this email. Do not share this code with anyone.
          </p>

          <div class="footer">
            © 2026 EduGuard AI Academic Systems. All rights reserved.<br>
            Secure Multi-Role Proctored Virtual Classroom
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: fromAddress,
      to: toEmail,
      subject: `🎓 Your EduGuard AI Verification Code: ${otpCode}`,
      text: `Your EduGuard AI verification code is: ${otpCode}. It is valid for 10 minutes.`,
      html: htmlContent
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EMAIL DISPATCH] Email sent to ${toEmail}. MessageID: ${info.messageId}`);
      
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[EMAIL PREVIEW URL] View email: ${previewUrl}`);
      }

      return {
        success: true,
        messageId: info.messageId,
        previewUrl: previewUrl || null
      };
    } catch (err) {
      console.error('[EMAIL DISPATCH ERROR]', err);
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = new EmailService();
