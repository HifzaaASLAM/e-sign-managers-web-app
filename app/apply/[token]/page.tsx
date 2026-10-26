import { PublicApplyForm } from "../../../components/apply/PublicApplyForm";

export const dynamic = "force-dynamic";

export default function ApplyPage({ params }: { params: { token: string } }) {
  return <PublicApplyForm token={params.token} />;
}
