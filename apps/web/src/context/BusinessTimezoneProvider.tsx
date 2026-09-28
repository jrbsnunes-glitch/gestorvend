import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { api } from '../lib/api';
import {
  resolveBusinessTimezone,
  setActiveBusinessTimezone,
} from '../lib/business-timezone';

type CompanyTzRow = {
  timezone?: string | null;
  state?: string | null;
};

export function BusinessTimezoneProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['company'],
    queryFn: () => api<CompanyTzRow>('/company'),
    staleTime: 10 * 60_000,
  });

  const tz = resolveBusinessTimezone(q.data ?? null);

  useEffect(() => {
    setActiveBusinessTimezone(tz);
  }, [tz]);

  return children;
}
