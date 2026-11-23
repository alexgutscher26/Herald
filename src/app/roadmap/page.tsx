import { redirect } from "next/navigation";

/**
 * Herald's marketing roadmap is not a second page to maintain. `/roadmap`
 * resolves to the real public roadmap published by the Herald workspace, so
 * the status on this link is the status the team uses.
 */
export default function RoadmapPage(): never {
  redirect("/p/herald/herald/roadmap");
}
