// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point
export type {
  Mailer,
  MailerOptions,
  Message,
  RecordingMailer,
  SendOutcome,
} from "./client";
export { createMailer, createRecordingMailer } from "./client";
export type {
  AddContactOutcome,
  Contact,
  ContactList,
  ContactListOptions,
  RecordingContactList,
} from "./contacts";
export { createContactList, createRecordingContactList } from "./contacts";
export type { OtpMessageInput } from "./otp";
export { otpMessage } from "./otp";
