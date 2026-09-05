import {
  policyVersionListResponseSchema,
  simulationRunsResponseSchema,
  simulationStatusSchema,
  type PolicyVersion,
  type SimulationRun,
  type SimulationStatus,
} from '@sentinel/contracts';

/**
 * Read-only fetchers several pages share. Each one was copied into four or five route files
 * verbatim; a change to a path or a schema then had to be made in every copy or the pages
 * quietly disagreed about what the API returns.
 */

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return response.json();
}

export async function fetchSimulationStatus(): Promise<SimulationStatus> {
  return simulationStatusSchema.parse(await getJson('/api/simulation/status'));
}

export async function fetchSimulationRuns(): Promise<SimulationRun[]> {
  return simulationRunsResponseSchema.parse(await getJson('/api/simulation/runs')).runs;
}

export async function fetchPolicyVersions(): Promise<PolicyVersion[]> {
  return policyVersionListResponseSchema.parse(await getJson('/api/policy/versions')).versions;
}
