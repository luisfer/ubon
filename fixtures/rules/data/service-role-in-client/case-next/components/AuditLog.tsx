'use client';
import { useEffect, useState } from 'react';
import { createAuditClient } from '../lib/supabase';

export function AuditLog() {
  const [rows, setRows] = useState<unknown[]>([]);
  useEffect(() => {
    createAuditClient()
      .from('audit_log')
      .select('*')
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return <pre>{JSON.stringify(rows)}</pre>;
}
