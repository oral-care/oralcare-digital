import { notFound } from "next/navigation";

// Closed until step 3 is approved (plan 12): every page answers 404.
export default function Home(): never {
  notFound();
}
