import { reserve } from "../lib/budget";
try {
  reserve("concurrent test", 2_000_000);
  process.exit(0);
} catch {
  process.exit(2);
}
