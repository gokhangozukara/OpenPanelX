import {
  handleCreateTableRow,
  handleDeleteTableRow,
  handleGetTable,
  handleUpdateTableRow,
} from "@/lib/api-handlers";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; index: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id, index } = await params;
  return handleGetTable(await getUser(), id, index);
}

export async function POST(request: Request, { params }: Params) {
  const { id, index } = await params;
  return handleCreateTableRow(request, await getUser(), id, index);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, index } = await params;
  return handleUpdateTableRow(request, await getUser(), id, index);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, index } = await params;
  return handleDeleteTableRow(request, await getUser(), id, index);
}
