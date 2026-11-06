import { IDLE, type ActionState } from '@/lib/actions';

export interface DuplicateCandidate {
  lead_id: string;
  lead_number: string;
  status: string;
  project_name: string;
  city: string;
  owner_name: string | null;
  created_at: string;
  reasons: string[];
  level: 'strong' | 'possible';
  distance_m: number | null;
  can_open: boolean;
}

export interface NewLeadState {
  result: ActionState;
  values: Record<string, string>;
  candidates: DuplicateCandidate[];
  attempt: number;
}

export const INITIAL_NEW_LEAD: NewLeadState = { result: IDLE, values: {}, candidates: [], attempt: 0 };

