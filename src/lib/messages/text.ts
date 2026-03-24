export function getMessagePlainText(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}
