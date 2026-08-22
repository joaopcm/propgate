import { apiRequest } from "../client";
import type { Command, Input } from "../command";
import { DEFAULT_API_URL, readConfig, writeConfig } from "../config";
import { EXIT_CANCELLED } from "../exit";
import { type Context, json, out, reportApiError } from "../output";
import { askText, CANCELLED } from "../prompt";

const CODE_LENGTH = 6;
const DIGITS = /^\d+$/;
const WHITESPACE = /\s/;

function emailComplaint(value: string): string | undefined {
  const at = value.indexOf("@");

  if (at < 1 || at === value.length - 1 || WHITESPACE.test(value)) {
    return "an email address needs a local part and a domain";
  }
}

const emailField = {
  describe: "The address to send the code to.",
  flag: "email",
  kind: "string" as const,
  placeholder: "you@example.com",
  prompt: "What is your email address?",
  required: true,
  validate: emailComplaint,
};

const codeField = {
  describe: "The six-digit code from the email.",
  flag: "code",
  kind: "string" as const,
  placeholder: "123456",
  prompt: "Enter the six-digit code",
  required: true,
  validate: (value: string) =>
    value.length === CODE_LENGTH && DIGITS.test(value)
      ? undefined
      : "the code is six digits",
};

interface Account {
  readonly apiKey: string;
  readonly created: boolean;
  readonly tenantId: string;
}

async function exchange(
  context: Context,
  email: string,
  code: string
): Promise<number> {
  const result = await apiRequest<Account>({
    apiUrl: context.apiUrl,
    body: { code, email },
    method: "POST",
    path: "/v1/signup/confirm",
  });

  if (!result.ok || result.body.data === null) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "confirmation failed"
    );
  }

  const { apiKey } = result.body.data;
  const stored = readConfig();
  const path = writeConfig({
    ...stored,
    apiKey,
    ...(context.apiUrl === DEFAULT_API_URL ? {} : { apiUrl: context.apiUrl }),
  });

  if (context.json) {
    return json({ ...result.body, meta: { configPath: path } });
  }

  out(result.body.data.created ? "Account created." : "Signed in.");
  out("");
  out(`  ${apiKey}`);
  out("");
  out(`Stored in ${path}. It will not be shown again.`);

  return 0;
}

async function signup(input: Input, context: Context): Promise<number> {
  const email = input.need("email");
  const result = await apiRequest<{ status: string }>({
    apiUrl: context.apiUrl,
    body: { email },
    method: "POST",
    path: "/v1/signup",
  });

  if (!result.ok) {
    return reportApiError(
      result.status,
      result.body.error?.message,
      "signup failed"
    );
  }

  if (context.json) {
    return json(result.body);
  }

  out(`If ${email} can receive mail, a six-digit code is on its way.`);
  out("It expires in ten minutes.");

  if (!context.interactive) {
    out("");
    out(`  propgate confirm --email ${email} --code <code>`);

    return 0;
  }

  out("");

  const code = await askText(codeField);

  if (code === CANCELLED) {
    out("Cancelled. Run `propgate confirm` when the code arrives.");

    return EXIT_CANCELLED;
  }

  return await exchange(context, email, code);
}

export const signupCommand: Command = {
  authenticated: false,
  examples: ["propgate signup --email you@example.com"],
  fields: [emailField],
  networked: true,
  path: ["signup"],
  run: signup,
  summary:
    "Start an account. Sends a six-digit code, valid ten minutes. In a terminal it goes on to ask for the code.",
};

export const confirmCommand: Command = {
  authenticated: false,
  examples: ["propgate confirm --email you@example.com --code 123456"],
  fields: [emailField, codeField],
  networked: true,
  path: ["confirm"],
  run: async (input, context) =>
    await exchange(context, input.need("email"), input.need("code")),
  summary:
    "Exchange the code for an API key. The key is stored at mode 0600 and shown once.",
};
