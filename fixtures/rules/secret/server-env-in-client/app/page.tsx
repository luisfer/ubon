import { Chat } from './components/Chat';

export default function Page() {
  const flag = process.env.FEATURE_FLAG; // ok: Server Component
  return <main data-flag={flag}><Chat /></main>;
}
