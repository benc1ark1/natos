import Link from 'next/link'
import SubjectDetail from '@/components/SubjectDetail'
import { Empty } from '@/components/ui'

// an old or mistyped link: say so instead of showing the database's error
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return <Empty>That subject doesn’t exist. <Link href="/subjects">Back to Subjects</Link></Empty>
  return <SubjectDetail key={id} id={id} />
}
