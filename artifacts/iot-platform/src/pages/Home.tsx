import ProjectsHome from "@/pages/ProjectsHome";

/**
 * The `/` route. Home has one job: pick a project and go.
 *
 * HomeOverview and Dashboard are no longer reachable. Their files are kept until
 * it is confirmed nobody misses them.
 */
export default function Home() {
  return <ProjectsHome />;
}
