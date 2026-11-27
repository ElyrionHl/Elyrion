import { notFound, permanentRedirect } from "next/navigation";
import { parseAddressInput } from "@/lib/prescore/view";

/**
 * Validates the address before the loading boundary streams, so a bad address is a real 404 and a
 * mixed-case one a real 308 to the lowercase URL (one canonical URL per address for caches and shares).
 */
export default async function ScoreAddressLayout({ children, params }: LayoutProps<"/score/[address]">) {
  const raw = (await params).address;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const address = parseAddressInput(decoded);
  if (!address) notFound();
  if (raw !== address) permanentRedirect(`/score/${address}`);
  return children;
}
