import bs58 from "bs58";

const key = process.argv[2];

if (!key) {
  console.log("Usage: npx ts-node convert-key.ts <your-base58-private-key>");
  console.log("");
  console.log("Paste the private key you exported from Phantom.");
  console.log("It will be converted to the byte array format for .env");
  process.exit(1);
}

try {
  const bytes = bs58.decode(key);
  const array = `[${Array.from(bytes).join(",")}]`;
  console.log("");
  console.log("Copy this into your .env file as PRIVATE_KEY:");
  console.log("");
  console.log(array);
  console.log("");
} catch {
  console.error("Invalid base58 key. Make sure you copied the full key from Phantom.");
  process.exit(1);
}
