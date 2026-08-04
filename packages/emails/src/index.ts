// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point
export type {
  Mailer,
  MailerOptions,
  Message,
  RecordingMailer,
  SendOutcome,
} from "./client";
export { createMailer, createRecordingMailer } from "./client";
export type { OtpMessageInput } from "./otp";
export { otpMessage } from "./otp";
