export interface CustomerTemplateContext {
  id: string;
  name: string;
  phone: string;
  city?: string | null | undefined;
  lastPurchaseAt?: Date | null | undefined;
  owner?: { name: string } | null | undefined;
}

export function extractTemplateVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g);
  const vars = new Set<string>();
  for (const match of matches) {
    if (match[1]) vars.add(match[1].toLowerCase());
  }
  return [...vars];
}

export function buildCustomerTemplateVariables(
  customer: CustomerTemplateContext,
  now: Date = new Date(),
): Record<string, string> {
  const firstName = customer.name.trim().split(/\s+/)[0] ?? customer.name;
  let diasInativo = 'indefinido';
  let dataUltimaCompra = 'nenhuma compra registrada';

  if (customer.lastPurchaseAt) {
    const diffMs = now.getTime() - customer.lastPurchaseAt.getTime();
    const days = Math.floor(diffMs / 86_400_000);
    diasInativo = String(Math.max(0, days));
    dataUltimaCompra = customer.lastPurchaseAt.toISOString().slice(0, 10);
  }

  return {
    nome: customer.name,
    primeiro_nome: firstName,
    telefone: customer.phone,
    cidade: customer.city ?? 'sua cidade',
    dias_inativo: diasInativo,
    ultima_compra: dataUltimaCompra,
    responsavel: customer.owner?.name ?? 'nossa equipe',
  };
}

export function renderTemplate(
  content: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  const normalizedVars = new Map<string, string>();
  for (const [key, value] of Object.entries(variables)) {
    normalizedVars.set(key.toLowerCase(), value !== null && value !== undefined ? String(value) : '');
  }

  return content.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, varName: string) => {
    const lower = varName.toLowerCase();
    return normalizedVars.has(lower) ? (normalizedVars.get(lower) ?? '') : match;
  });
}
