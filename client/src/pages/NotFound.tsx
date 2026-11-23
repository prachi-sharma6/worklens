import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState, Button } from '@/components/ui';

export default function NotFound() {
  return <div className="card"><EmptyState icon={<Compass size={18} />} title="Page not found" body="That page doesn’t exist. Use Ctrl+K to jump anywhere." action={<Link to="/"><Button variant="primary">Go home</Button></Link>} /></div>;
}
