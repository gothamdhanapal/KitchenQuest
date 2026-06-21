import { getDashboardData } from "@/lib/dashboard";
import { getExpiryState } from "@/lib/expiry";
import type { InventoryItem, InventoryStock, PurchaseLog } from "@/lib/types";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const authMessage = getAuthMessage(params);
  const importMessage = getImportMessage(params);
  const data = await getDashboardData();

  if (data.mode === "signed_out") {
    return <SignedOut authMessage={authMessage} />;
  }

  if (data.mode === "setup_required") {
    return <SetupRequired error={data.setupError} userEmail={data.userEmail} />;
  }

  const totalByItem = getTotalStockByItem(data.stock);
  const itemsToBuy = data.inventoryItems.filter(
    (item) => item.essential_to_refill && (totalByItem.get(item.id) ?? 0) <= 0,
  );
  const expiredCount = data.stock.filter((stock) => getExpiryState(stock.expiry_date) === "expired").length;
  const expiringSoonCount = data.stock.filter((stock) => getExpiryState(stock.expiry_date) === "soon").length;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-[2rem] bg-[#18391f] p-6 text-white shadow-xl shadow-green-950/10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-lime-200">FreshLoop</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
                Pantry freshness, from your delivery emails.
              </h1>
              <p className="mt-4 max-w-2xl text-base text-lime-50/80">
                Track Instamart and Blinkit purchases, review unmatched products, and keep essentials visible
                before they run out.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {data.mode === "demo" ? (
                <span className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-lime-50">
                  Demo data - add Supabase env vars to go live
                </span>
              ) : (
                <>
                  <a
                    href="/api/gmail/oauth/start"
                    className="rounded-full bg-lime-300 px-4 py-2 text-sm font-bold text-green-950"
                  >
                    Connect Gmail
                  </a>
                  <form action="/api/auth/sign-out" method="post">
                    <button className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white">
                      Sign out
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </header>

        {importMessage ? (
          <p className="rounded-3xl bg-lime-50 p-4 text-sm font-semibold text-green-950 ring-1 ring-lime-200">
            {importMessage}
          </p>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <Stat label="Active Gmail accounts" value={String(data.gmailConnections)} />
          <Stat label="Expiring soon" value={String(expiringSoonCount)} tone="amber" />
          <Stat label="Expired" value={String(expiredCount)} tone="red" />
          <Stat label="Needs review" value={String(data.needsReview.length)} tone="blue" />
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.9fr]">
          <Card title="Pantry">
            <div className="divide-y divide-green-100">
              {data.stock.length === 0 ? (
                <EmptyState message="No stock yet. Run ingestion or import purchases to populate the pantry." />
              ) : (
                data.stock.map((stock) => <StockRow key={stock.id} stock={stock} />)
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-6">
            <Card title="Import recent orders">
              <form action="/api/ingest/backfill" method="post" className="flex flex-col gap-3">
                <p className="text-sm text-slate-600">
                  Re-scan connected Gmail accounts for recent Instamart and Blinkit orders. Imports are capped at
                  7 days and repeated scans will skip already logged purchases.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    name="lookbackDays"
                    defaultValue="7"
                    className="min-w-0 flex-1 rounded-xl border border-green-100 bg-white px-3 py-2 text-sm"
                  >
                    <option value="1">Today / last 24 hours</option>
                    <option value="7">Last 7 days</option>
                  </select>
                  <button className="rounded-xl bg-green-800 px-4 py-2 text-sm font-bold text-white">
                    Pull orders
                  </button>
                </div>
              </form>
            </Card>

            <Card title="Items to buy">
              <div className="flex flex-col gap-3">
                {itemsToBuy.length === 0 ? (
                  <EmptyState message="All essential refill items currently have stock." />
                ) : (
                  itemsToBuy.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-green-100 bg-white p-4">
                      <p className="font-semibold text-green-950">{item.item_name}</p>
                      <p className="text-sm text-slate-500">
                        {item.category} · default {item.default_shelf_life_days} days
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card title="Needs review">
            <div className="flex flex-col gap-3">
              {data.needsReview.length === 0 ? (
                <EmptyState message="No unmatched purchases waiting for review." />
              ) : (
                data.needsReview.map((purchase) => (
                  <ReviewRow key={purchase.id} purchase={purchase} inventoryItems={data.inventoryItems} />
                ))
              )}
            </div>
          </Card>

          <Card title="Purchase history">
            <div className="divide-y divide-green-100">
              {data.purchases.length === 0 ? (
                <EmptyState message="Parsed purchases will appear here after ingestion runs." />
              ) : (
                data.purchases.map((purchase) => <PurchaseRow key={purchase.id} purchase={purchase} />)
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

function SetupRequired({ error, userEmail }: Readonly<{ error: string; userEmail: string | null }>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-2xl rounded-[2rem] bg-white p-8 shadow-xl shadow-green-950/10">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">FreshLoop setup</p>
        <h1 className="mt-4 text-3xl font-bold text-green-950">Supabase schema is not installed yet</h1>
        <p className="mt-3 text-slate-600">
          You are signed in{userEmail ? ` as ${userEmail}` : ""}, but FreshLoop cannot find its database
          tables in this Supabase project.
        </p>
        <pre className="mt-4 overflow-auto rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-100">
          {error}
        </pre>
        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-bold text-green-950">Next step</p>
          <p className="mt-2">Apply the migration in one of these ways:</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
              CLI: run <code className="rounded bg-white px-1">npx supabase db push</code> after linking the
              project.
            </li>
            <li>
              Dashboard: open Supabase SQL Editor and run the SQL from{" "}
              <code className="rounded bg-white px-1">
                supabase/migrations/20260610184700_init_freshloop_schema.sql
              </code>
              .
            </li>
          </ol>
        </div>
        <form action="/api/auth/sign-out" method="post" className="mt-6">
          <button className="rounded-2xl bg-green-800 px-4 py-3 font-bold text-white">Sign out</button>
        </form>
      </section>
    </main>
  );
}

function SignedOut({ authMessage }: Readonly<{ authMessage: string | null }>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-[2rem] bg-white p-8 shadow-xl shadow-green-950/10">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-green-700">FreshLoop</p>
        <h1 className="mt-4 text-3xl font-bold text-green-950">Sign in to your household pantry</h1>
        <p className="mt-3 text-slate-600">
          Enter one of the household email addresses. Supabase will send a magic link.
        </p>
        {authMessage ? (
          <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-100">
            {authMessage}
          </p>
        ) : null}
        <form action="/api/auth/sign-in" method="post" className="mt-6 flex flex-col gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="rounded-2xl border border-green-100 px-4 py-3 outline-none ring-green-400 focus:ring-2"
          />
          <button className="rounded-2xl bg-green-800 px-4 py-3 font-bold text-white">Send magic link</button>
        </form>
      </section>
    </main>
  );
}

function getAuthMessage(params: Record<string, string | string[] | undefined> | undefined): string | null {
  const auth = getFirstParam(params?.auth);

  if (auth === "check_email") {
    return "Check your email for the FreshLoop magic link.";
  }

  if (auth === "missing_email") {
    return "Please enter an email address.";
  }

  if (auth === "sign_in_failed") {
    const message = getFirstParam(params?.message);
    return message ? `Supabase sign-in failed: ${message}` : "Supabase sign-in failed. Check the terminal logs.";
  }

  return null;
}

function getImportMessage(params: Record<string, string | string[] | undefined> | undefined): string | null {
  const status = getFirstParam(params?.import);

  if (!status) {
    return null;
  }

  if (status === "no_connections") {
    return "Connect Gmail before importing recent orders.";
  }

  if (status === "not_authenticated") {
    return "Sign in before importing recent orders.";
  }

  if (status === "failed") {
    const message = getFirstParam(params?.message);
    return message ? `Import failed: ${message}` : "Import failed. Check the terminal logs.";
  }

  const days = getFirstParam(params?.days) ?? "7";
  const emails = getFirstParam(params?.emails) ?? "0";
  const items = getFirstParam(params?.items) ?? "0";
  const inserted = getFirstParam(params?.inserted) ?? "0";
  const retailers = getFirstParam(params?.retailers);
  const retailerDetails = retailers ? ` Retailer scan: ${retailers}.` : "";

  if (status === "partial") {
    const message = getFirstParam(params?.message);
    return `Imported with warnings over the last ${days} day(s): scanned ${emails} email(s), extracted ${items} item(s), added ${inserted} purchase row(s).${retailerDetails}${message ? ` First warning: ${message}` : ""}`;
  }

  if (status === "complete") {
    if (emails === "0") {
      return `Import complete, but no matching Instamart or Blinkit emails were found in the last ${days} day(s).${retailerDetails} Try "Last 7 days" if you only scanned today.`;
    }

    return `Import complete for the last ${days} day(s): scanned ${emails} email(s), extracted ${items} item(s), added ${inserted} purchase row(s).${retailerDetails}`;
  }

  return null;
}

function getFirstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Card({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-[1.5rem] bg-white p-5 shadow-sm ring-1 ring-green-100">
      <h2 className="mb-4 text-xl font-bold text-green-950">{title}</h2>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "green",
}: Readonly<{ label: string; value: string; tone?: "green" | "amber" | "red" | "blue" }>) {
  const toneClass = {
    amber: "bg-amber-50 text-amber-900 ring-amber-100",
    blue: "bg-sky-50 text-sky-900 ring-sky-100",
    green: "bg-white text-green-950 ring-green-100",
    red: "bg-red-50 text-red-900 ring-red-100",
  }[tone];

  return (
    <section className={`rounded-3xl p-5 shadow-sm ring-1 ${toneClass}`}>
      <p className="text-sm font-medium opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </section>
  );
}

function StockRow({ stock }: Readonly<{ stock: InventoryStock }>) {
  const state = getExpiryState(stock.expiry_date);

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-green-950">{stock.inventory_items?.item_name ?? stock.item_id}</p>
        <p className="text-sm text-slate-500">
          {stock.quantity} {stock.inventory_items?.unit ?? "unit"} · {stock.inventory_items?.category ?? "uncategorized"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <ExpiryBadge state={state} />
        <span className="text-sm font-medium text-slate-600">{formatDate(stock.expiry_date)}</span>
      </div>
    </div>
  );
}

function ReviewRow({
  purchase,
  inventoryItems,
}: Readonly<{ purchase: PurchaseLog; inventoryItems: InventoryItem[] }>) {
  return (
    <form action="/api/review/map" method="post" className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
      <input type="hidden" name="purchaseId" value={purchase.id} />
      <p className="font-semibold text-sky-950">{purchase.raw_product_name}</p>
      <p className="mt-1 text-sm text-sky-800/70">
        {purchase.retailer} · qty {purchase.quantity}
        {purchase.price ? ` · ₹${purchase.price}` : ""}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          name="itemId"
          required
          className="min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm"
        >
          <option value="">Map to inventory item...</option>
          {inventoryItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.item_name}
            </option>
          ))}
        </select>
        <button className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white">Save mapping</button>
      </div>
    </form>
  );
}

function PurchaseRow({ purchase }: Readonly<{ purchase: PurchaseLog }>) {
  return (
    <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-green-950">
          {purchase.inventory_items?.item_name ?? purchase.raw_product_name}
        </p>
        <p className="text-sm text-slate-500">
          {purchase.retailer} · {formatDate(purchase.order_date)} · qty {purchase.quantity}
        </p>
      </div>
      <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
        {purchase.status.replace("_", " ")}
      </span>
    </div>
  );
}

function ExpiryBadge({ state }: Readonly<{ state: "expired" | "soon" | "ok" }>) {
  const className = {
    expired: "bg-red-100 text-red-800",
    ok: "bg-green-100 text-green-800",
    soon: "bg-amber-100 text-amber-800",
  }[state];

  return <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${className}`}>{state}</span>;
}

function EmptyState({ message }: Readonly<{ message: string }>) {
  return <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">{message}</p>;
}

function getTotalStockByItem(stock: InventoryStock[]): Map<string, number> {
  return stock.reduce((totals, stockLot) => {
    totals.set(stockLot.item_id, (totals.get(stockLot.item_id) ?? 0) + Number(stockLot.quantity));
    return totals;
  }, new Map<string, number>());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
