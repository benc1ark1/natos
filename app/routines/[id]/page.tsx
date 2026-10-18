import Link from 'next/link'
import RoutineView from '@/components/RoutineView'
import { Empty } from '@/components/ui'

// an old or mistyped link: say so instead of showing the database's error
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return <Empty>That routine doesn’t exist. <Link href="/">Back to Home</Link></Empty>
  return <RoutineView key={id} id={id} />
}
