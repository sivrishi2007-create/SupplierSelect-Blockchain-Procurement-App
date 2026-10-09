import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { BrowserProvider, Contract, concat, getBytes, hexlify, sha256, toUtf8Bytes } from 'ethers';
import {
  useCreateEvaluation, useCreateSupplier, useDeleteSupplier, useGetActivity,
  useGetCriteria, useGetDashboard, useGetEvaluation, useGetEvaluations,
  useGetSuppliers, useSaveEvaluationAnchor, useUpdateCriteria, useUpdateSupplier,
  getGetActivityQueryKey, getGetCriteriaQueryKey, getGetDashboardQueryKey,
  getGetEvaluationsQueryKey, getGetEvaluationQueryKey, getGetSuppliersQueryKey,
} from '@workspace/api-client-react';
import type { Activity, CriteriaRule, CriteriaSetInput, Evaluation, EvaluationAnchorInput, Supplier, SupplierInput } from '@workspace/api-client-react';
import {
  Activity as ActivityIcon, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck,
  BarChart3, Check, CheckCircle2, ChevronDown, CircleHelp, Clipboard, Clock3, Coins,
  FileCheck2, FileText, Fingerprint, Gauge, LayoutDashboard, Link2, LoaderCircle,
  MapPin, Menu, Pencil, Plus, Search, Settings2, Shield, ShieldCheck, SlidersHorizontal,
  Sparkles, Trash2, Trophy, Wallet, X, XCircle, Zap,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const contractFromEnv = import.meta.env.VITE_ANCHOR_CONTRACT_ADDRESS as string | undefined;
const anchorAbi = [
  'function anchor(uint256 evaluationId, bytes32 reportHash) external',
  'function anchors(uint256 evaluationId) view returns (bytes32)',
  'event EvaluationAnchored(uint256 indexed evaluationId, bytes32 indexed reportHash, address indexed evaluator)',
];
const stableObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableObject(item)]));
  }
  return value;
};
const reportDigest = (evaluation: Pick<Evaluation, 'id' | 'criteriaSnapshot' | 'ranked' | 'disqualified'>, salt: Uint8Array) => {
  const payload = JSON.stringify(stableObject({
    evaluationId: evaluation.id,
    criteriaSnapshot: evaluation.criteriaSnapshot,
    ranked: evaluation.ranked,
    disqualified: evaluation.disqualified,
  }));
  return sha256(concat([toUtf8Bytes(payload), salt]));
};
const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/suppliers', label: 'Suppliers', icon: BarChart3 },
  { href: '/criteria', label: 'Evaluation rubric', icon: SlidersHorizontal },
  { href: '/evaluations', label: 'Reports', icon: FileText },
  { href: '/activity', label: 'Audit activity', icon: ActivityIcon },
];
const fmtDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
const fmtTime = (value?: string | null) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
const money = (value?: number | null) => value == null ? '—' : `$${value.toFixed(2)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function Button({ children, onClick, variant = 'primary', className = '', disabled = false, testId, type = 'button' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; className?: string;
  disabled?: boolean; testId: string; type?: 'button' | 'submit';
}) {
  const palette = {
    primary: 'bg-[#20594d] text-[#fffdf6] hover:bg-[#17463d]',
    secondary: 'bg-[#e9e5da] text-[#28443e] hover:bg-[#ded9cc]',
    ghost: 'text-[#52665f] hover:bg-[#ebe8df]',
    danger: 'text-[#a83d31] hover:bg-[#f7e5df]',
  };
  return <button type={type} data-testid={testId} onClick={onClick} disabled={disabled}
    className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${palette[variant]} ${className}`}>
    {children}
  </button>;
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#e3dfd4] bg-[#fffdf8] shadow-[0_8px_25px_rgba(43,54,44,.035)] ${className}`}>{children}</section>;
}

function SectionTitle({ eyebrow, title, note, action }: { eyebrow: string; title: string; note?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div><div className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#927e5f]">{eyebrow}</div>
      <h1 className="display-font text-3xl font-bold tracking-[-.045em] text-[#203936] sm:text-[38px]">{title}</h1>
      {note && <p className="mt-2 max-w-2xl text-sm leading-6 text-[#75817a]">{note}</p>}</div>{action}
  </div>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-label="Loading" />;
}

function QueryState({ loading, error, onRetry, children }: { loading: boolean; error?: unknown; onRetry: () => void; children: ReactNode }) {
  if (loading) return <div className="space-y-4" aria-label="Loading content"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error) return <Panel className="p-8 text-center"><CircleHelp className="mx-auto mb-3 text-[#b36848]" size={25} /><h2 className="display-font text-lg font-bold">Could not load this view</h2><p className="mx-auto mt-2 max-w-lg text-sm text-[#75817a]">{errorText(error)}</p><Button className="mt-5" onClick={onRetry} testId="button-retry">Try again</Button></Panel>;
  return <>{children}</>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const title = navItems.find(item => item.href === path)?.label || (path.startsWith('/evaluations/') ? 'Report detail' : 'Workspace');
  const nav = <nav className="space-y-1.5">
    {navItems.map(({ href, label, icon: Icon }) => {
      const active = href === '/' ? path === '/' : path === href || (href === '/evaluations' && path.startsWith('/evaluations/'));
      return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] font-semibold transition ${active ? 'bg-[#31564d] text-[#fff8e9]' : 'text-[#b8cbc0] hover:bg-[#294741] hover:text-white'}`}>
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#e8a462]" />}
      </Link>;
    })}
  </nav>;
  return <div className="app-shell flex min-h-[100dvh]">
    <aside className="sidebar hidden shrink-0 flex-col px-4 py-6 md:flex">
      <Link href="/" data-testid="link-brand" className="mb-10 flex items-center gap-3 px-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#e1a269] text-[#23433b]"><span className="display-font text-[21px] font-extrabold">S</span></span>
        <span><span className="display-font block text-[18px] font-extrabold tracking-[-.04em] text-[#fff8e9]">SupplierSelect</span><span className="text-[10px] font-medium tracking-[.14em] text-[#9bb1a4]">PROCUREMENT DESK</span></span>
      </Link>
      <div className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[.2em] text-[#829b8d]">Workspace</div>{nav}
      <div className="mt-auto">
        <div className="mb-5 rounded-2xl border border-[#ffffff14] bg-[#ffffff08] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#f4e5c9]"><ShieldCheck size={15} />Private by design</div>
          <p className="text-[11px] leading-[1.65] text-[#a6b9ae]">Supplier details stay here. Only a report fingerprint can be anchored.</p>
        </div>
        <Link href="/settings" data-testid="link-nav-settings" className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] font-semibold ${path === '/settings' ? 'bg-[#31564d] text-white' : 'text-[#b8cbc0] hover:bg-[#294741]'}`}><Settings2 size={17} />Settings</Link>
        <div className="mt-4 flex items-center gap-3 border-t border-[#ffffff18] pt-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#45685c] text-xs font-bold text-[#fff8e9]">PD</div>
          <div className="min-w-0"><div className="text-xs font-semibold text-[#edf2e9]">Procurement desk</div><div className="text-[10px] text-[#9bb1a4]">Local workspace</div></div>
          <span className="ml-auto h-2 w-2 rounded-full bg-[#79b28b]" title="Workspace ready" />
        </div>
      </div>
    </aside>
    {mobileOpen && <div className="fixed inset-0 z-50 flex md:hidden"><button aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-[#15262299]" data-testid="button-close-menu" /><aside className="sidebar relative flex w-[min(290px,86vw)] flex-col px-4 py-6 shadow-2xl"><div className="mb-8 flex items-center justify-between px-2"><span className="display-font text-lg font-extrabold">SupplierSelect</span><button onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X size={20} /></button></div>{nav}<Link href="/settings" onClick={() => setMobileOpen(false)} className="mt-3 flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm"><Settings2 size={17} />Settings</Link></aside></div>}
    <div className="main-panel flex min-h-[100dvh] flex-1 flex-col">
      <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-[#e6e1d7] bg-[#f8f5ed]/95 px-4 backdrop-blur sm:px-7 lg:px-10">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} data-testid="button-open-menu" className="rounded-lg p-2 text-[#34574d] hover:bg-[#e9e5da] md:hidden" aria-label="Open navigation"><Menu size={19} /></button>
          <span className="text-xs font-semibold text-[#87918a]">SupplierSelect</span><span className="text-[#c0baad]">/</span><span className="text-xs font-semibold text-[#30483f]">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings" data-testid="link-wallet-status" className="inline-flex items-center gap-2 rounded-full border border-[#e1ddd2] bg-[#fffdf8] px-3 py-2 text-[11px] font-semibold text-[#5d6d64] hover:border-[#b9c9be]"><span className="h-1.5 w-1.5 rounded-full bg-[#d8a46d]" /><span className="hidden sm:inline">Sepolia setup</span><Wallet size={14} className="sm:hidden" /></Link>
          <div className="relative">
            <button onClick={() => setMenu(!menu)} aria-label="Workspace menu" aria-expanded={menu} data-testid="button-workspace-menu" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8dfcc] text-[11px] font-bold text-[#36574b]">PD<ChevronDown size={12} className="ml-0.5" /></button>
            {menu && <div className="absolute right-0 top-11 z-40 w-48 rounded-xl border border-[#e2ddd1] bg-[#fffdf8] p-1.5 shadow-xl"><Link href="/settings" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm text-[#344c42] hover:bg-[#f1eee6]">Workspace settings</Link><Link href="/activity" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm text-[#344c42] hover:bg-[#f1eee6]">Audit activity</Link></div>}
          </div>
        </div>
      </header>
      <main className="page-enter mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 sm:px-7 sm:py-9 lg:px-10">{children}</main>
      <footer className="mx-4 flex items-center justify-between border-t border-[#e6e1d7] py-4 text-[10px] text-[#8a938b] sm:mx-7 lg:mx-10"><span>SupplierSelect · verifiable decisions, private supplier data</span><span className="mono">SEP · TESTNET READY</span></footer>
    </div>
  </div>;
}

function InlineError({ children }: { children: ReactNode }) {
  return <div role="alert" data-testid="status-error" className="mb-4 flex items-start gap-2 rounded-xl border border-[#e9c7bd] bg-[#fbefea] p-3 text-sm text-[#963c30]"><XCircle size={17} className="mt-0.5 shrink-0" />{children}</div>;
}

function EmptyState({ icon: Icon, title, body, action }: { icon: typeof FileText; title: string; body: string; action?: ReactNode }) {
  return <div className="px-5 py-14 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef0e8] text-[#55796a]"><Icon size={21} /></div><h3 className="display-font text-lg font-bold text-[#30483f]">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#7b867e]">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function Metric({ label, value, detail, icon: Icon, color = 'green' }: { label: string; value: string | number; detail: string; icon: typeof FileText; color?: 'green' | 'orange' | 'blue' }) {
  const colorClass = color === 'orange' ? 'bg-[#f7ebdc] text-[#aa6935]' : color === 'blue' ? 'bg-[#e7ece8] text-[#597667]' : 'bg-[#e4eee7] text-[#356a55]';
  return <Panel className="relative overflow-hidden p-5 sm:p-6"><div className="flex items-start justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#829087]">{label}</div><div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="display-font mt-3 text-[34px] font-bold tracking-[-.06em] text-[#243e38]">{value}</div><div className="mt-1 text-xs text-[#838d84]">{detail}</div></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${colorClass}`}><Icon size={18} /></span></div></Panel>;
}

function DashboardPage() {
  const query = useGetDashboard();
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    {query.data && <div>
      <SectionTitle eyebrow="Procurement overview · workspace 01" title="Good decisions, on record." note="A consistent view of the suppliers you trust—and the evidence behind each choice."
        action={<Link href="/criteria" data-testid="link-run-evaluation" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#20594d] px-4 text-sm font-semibold text-white hover:bg-[#17463d]"><Zap size={16} />Run evaluation<ArrowRight size={15} /></Link>} />
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active suppliers" value={query.data.supplierCount} detail="In your comparison pool" icon={BarChart3} />
        <Metric label="Evaluations run" value={query.data.evaluationCount} detail="Saved decision reports" icon={FileCheck2} color="blue" />
        <Metric label="Anchored reports" value={query.data.anchoredCount} detail="Verified on Sepolia" icon={ShieldCheck} color="orange" />
        <Metric label="Average winner score" value={query.data.averageWinnerScore == null ? '—' : query.data.averageWinnerScore.toFixed(1)} detail="Across saved evaluations" icon={Gauge} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#ebe7de] px-5 py-4 sm:px-6"><div><div className="display-font font-bold text-[#30483f]">Recent evaluations</div><p className="mt-1 text-xs text-[#89928a]">Your latest supplier decisions</p></div><Link href="/evaluations" data-testid="link-all-evaluations" className="flex items-center gap-1 text-xs font-bold text-[#36705d] hover:underline">All reports <ArrowRight size={13} /></Link></div>
          {query.data.recentEvaluations.length ? <div className="divide-y divide-[#eeeae2]">
            {query.data.recentEvaluations.map(item => <Link href={`/evaluations/${item.id}`} key={item.id} data-testid={`row-recent-evaluation-${item.id}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-[#f8f6ef] sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf1e7] text-[#47705a]">{item.anchor ? <ShieldCheck size={18} /> : <FileText size={17} />}</div>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#30483f]">{item.winnerName || 'No qualified supplier'}</div><div className="mt-1 text-xs text-[#859087]">{fmtDate(item.createdAt)} · {item.supplierCount} evaluated · {item.criteriaCount} criteria</div></div>
              <div className="text-right"><div className="mono text-sm font-medium text-[#30483f]">{item.winnerScore == null ? '—' : item.winnerScore.toFixed(2)}</div><div className={`mt-1 text-[10px] font-bold uppercase tracking-wider ${item.anchor ? 'text-[#568064]' : 'text-[#a5906d]'}`}>{item.anchor ? 'Anchored' : 'Not anchored'}</div></div><ArrowUpRight className="text-[#a9afa7]" size={16} />
            </Link>)}
          </div> : <EmptyState icon={FileCheck2} title="No decisions yet" body="Your saved evaluations will appear here. Start with a rubric to make every comparison consistent." action={<Link href="/criteria" className="text-sm font-bold text-[#36705d]">Configure rubric <ArrowRight className="ml-1 inline" size={14} /></Link>} />}
        </Panel>
        <ActivityPanel items={query.data.recentActivity} loading={false} />
      </div>
      <Panel className="mt-5 flex flex-col gap-4 bg-[#e9eee5] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d6e3d8] text-[#456f58]"><Fingerprint size={19} /></div><div><div className="display-font font-bold text-[#30483f]">An audit trail without the data leak.</div><p className="mt-1 max-w-xl text-xs leading-5 text-[#748078]">Supplier details stay off-chain. Anchor a compact report fingerprint when you need independent proof of a decision.</p></div></div>
        <Link href="/settings" className="shrink-0 text-xs font-bold text-[#36705d] hover:underline">Review verification setup <ArrowRight size={13} className="ml-1 inline" /></Link>
      </Panel>
    </div>}
  </QueryState>;
}

function ActivityPanel({ items, loading }: { items: Activity[]; loading: boolean }) {
  return <Panel className="overflow-hidden">
    <div className="flex items-center justify-between border-b border-[#ebe7de] px-5 py-4"><div><div className="display-font font-bold text-[#30483f]">Audit activity</div><p className="mt-1 text-xs text-[#89928a]">A tamper-evident operational timeline</p></div><Link href="/activity" data-testid="link-view-activity" className="text-xs font-bold text-[#36705d] hover:underline">View all</Link></div>
    {loading ? <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : items.length ? <div className="divide-y divide-[#eeeae2]">
      {items.slice(0, 6).map(item => <ActivityRow key={item.id} item={item} />)}
    </div> : <EmptyState icon={ActivityIcon} title="Quiet so far" body="Supplier changes, rubric updates, and evaluations will be recorded here." />}
  </Panel>;
}

function ActivityRow({ item }: { item: Activity }) {
  const anchored = item.eventType === 'evaluation_anchored';
  return <div data-testid={`activity-row-${item.id}`} className="flex gap-3 px-5 py-3.5">
    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${anchored ? 'bg-[#f7ebdc] text-[#ad7040]' : 'bg-[#edf1e9] text-[#597965]'}`}>{anchored ? <ShieldCheck size={15} /> : item.eventType.includes('evaluation') ? <FileText size={15} /> : <ActivityIcon size={15} />}</div>
    <div className="min-w-0 flex-1"><div className="text-xs leading-[1.55] text-[#4f6359]">{item.message}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#929b92]"><Clock3 size={11} />{fmtTime(item.createdAt)}{item.evaluationId && <Link href={`/evaluations/${item.evaluationId}`} className="ml-1 font-semibold text-[#54816c] hover:underline">View report</Link>}</div></div>
  </div>;
}

function SuppliersPage() {
  const client = useQueryClient();
  const query = useGetSuppliers();
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const remove = useDeleteSupplier();
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const suppliers = useMemo(() => (query.data || []).filter(s => `${s.name} ${s.code} ${s.location} ${s.certifications.join(' ')}`.toLowerCase().includes(term.toLowerCase())), [query.data, term]);
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: getGetSuppliersQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const data = new FormData(event.currentTarget);
    const value: SupplierInput = {
      name: String(data.get('name')).trim(), location: String(data.get('location')).trim(),
      certifications: String(data.get('certifications')).split(',').map(v => v.trim()).filter(Boolean),
      price: Number(data.get('price')), quality: Number(data.get('quality')), delivery: Number(data.get('delivery')), reliability: Number(data.get('reliability')),
    };
    const done = () => { void refresh(); setAdding(false); setEditing(null); setNotice(editing ? 'Supplier updated.' : 'Supplier added.'); };
    if (editing) update.mutate({ id: editing.id, data: value }, { onSuccess: done, onError: err => setError(errorText(err)) });
    else create.mutate({ data: value }, { onSuccess: done, onError: err => setError(errorText(err)) });
  };
  const deleteSupplier = (supplier: Supplier) => {
    if (!window.confirm(`Remove ${supplier.name} from the supplier list?`)) return;
    remove.mutate({ id: supplier.id }, { onSuccess: () => { void refresh(); setNotice(`${supplier.name} removed.`); }, onError: err => setError(errorText(err)) });
  };
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <SectionTitle eyebrow="Supplier register · 02" title="Your supplier pool." note="Keep the facts that make comparisons repeatable. Changes are recorded in the audit activity."
      action={<Button onClick={() => { setAdding(true); setNotice(''); }} testId="button-add-supplier"><Plus size={16} />Add supplier</Button>} />
    {notice && <div role="status" data-testid="status-success" className="mb-4 flex items-center gap-2 rounded-xl border border-[#c6dacb] bg-[#edf4ec] px-4 py-3 text-sm text-[#386a4d]"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice('')} className="ml-auto" aria-label="Dismiss success message"><X size={15} /></button></div>}
    {error && <InlineError>{error}</InlineError>}
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#ebe7de] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative w-full sm:max-w-[340px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#909991]" /><input aria-label="Search suppliers" data-testid="input-search-suppliers" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by name, location, certification" className="h-10 w-full rounded-xl border border-[#e5e1d7] bg-[#fbfaf6] pl-9 pr-3 text-sm text-[#344c42] placeholder:text-[#a1a69e]" /></div>
        <div className="flex items-center gap-2 text-xs text-[#89928a]"><span className="inline-flex items-center gap-1"><SlidersHorizontal size={13} />{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</span></div>
      </div>
      {suppliers.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left"><thead><tr className="bg-[#f8f6ef] text-[10px] font-bold uppercase tracking-[.12em] text-[#8b948b]"><th className="px-5 py-3">Supplier</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Quality</th><th className="px-4 py-3">Delivery</th><th className="px-4 py-3">Reliability</th><th className="px-4 py-3">Certifications</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-[#eeeae2]">{suppliers.map(s => <tr key={s.id} data-testid={`row-supplier-${s.id}`} className="transition hover:bg-[#fbfaf6]">
            <td className="px-5 py-4"><div className="text-sm font-semibold text-[#334a40]">{s.name}</div><div className="mono mt-1 text-[10px] text-[#969e94]">{s.code}</div></td>
            <td className="px-4 py-4 text-xs text-[#67776d]"><MapPin size={12} className="mr-1 inline" />{s.location}</td>
            <td className="px-4 py-4"><ScorePill value={s.price} /></td><td className="px-4 py-4"><ScorePill value={s.quality} /></td><td className="px-4 py-4"><ScorePill value={s.delivery} /></td><td className="px-4 py-4"><ScorePill value={s.reliability} /></td>
            <td className="max-w-[180px] px-4 py-4"><div className="flex flex-wrap gap-1">{s.certifications.length ? s.certifications.slice(0, 2).map(cert => <span key={cert} className="rounded-md bg-[#edf0e8] px-2 py-1 text-[10px] text-[#66766b]">{cert}</span>) : <span className="text-xs text-[#a2a79f]">None</span>}{s.certifications.length > 2 && <span className="text-[10px] text-[#7d8a80]">+{s.certifications.length - 2}</span>}</div></td>
            <td className="px-4 py-4"><div className="flex justify-end gap-1"><button onClick={() => { setEditing(s); setAdding(true); setError(''); }} aria-label={`Edit ${s.name}`} data-testid={`button-edit-supplier-${s.id}`} className="rounded-lg p-2 text-[#718077] hover:bg-[#ebeee6] hover:text-[#315e4d]"><Pencil size={15} /></button><button onClick={() => deleteSupplier(s)} aria-label={`Delete ${s.name}`} data-testid={`button-delete-supplier-${s.id}`} className="rounded-lg p-2 text-[#9c736a] hover:bg-[#f8eae5] hover:text-[#a83d31]"><Trash2 size={15} /></button></div></td>
          </tr>)}</tbody>
        </table>
      </div> : <EmptyState icon={Search} title={term ? 'No matching suppliers' : 'Start your supplier register'} body={term ? `No suppliers match “${term}”. Try a different name or clear your search.` : 'Add the vendors you are considering. Price, quality, delivery and reliability are ready to compare.'} action={term ? <Button variant="secondary" onClick={() => setTerm('')} testId="button-clear-search">Clear search</Button> : <Button onClick={() => setAdding(true)} testId="button-empty-add-supplier"><Plus size={15} />Add a supplier</Button>} />}
    </Panel>
    {adding && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#14221f99] p-0 sm:items-center sm:p-5" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="supplier-dialog-title" className="max-h-[94dvh] w-full max-w-[700px] overflow-y-auto rounded-t-[22px] border border-[#e5dfd2] bg-[#fffdf8] p-5 shadow-2xl sm:rounded-[22px] sm:p-7">
        <div className="mb-5 flex items-start justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#987f5d]">{editing ? 'Supplier record' : 'New supplier'}</div><h2 id="supplier-dialog-title" className="display-font mt-1 text-2xl font-bold text-[#2f493f]">{editing ? 'Update supplier' : 'Add to your pool'}</h2></div><button onClick={() => { setAdding(false); setEditing(null); }} aria-label="Close supplier form" data-testid="button-close-supplier-form" className="rounded-lg p-2 text-[#758078] hover:bg-[#eeece4]"><X size={18} /></button></div>
        {error && <InlineError>{error}</InlineError>}
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2"><Field name="name" label="Supplier name" placeholder="e.g. Northstar Components" defaultValue={editing?.name} required /><Field name="location" label="Location" placeholder="City, country" defaultValue={editing?.location} required /></div>
          <Field name="certifications" label="Certifications" placeholder="ISO 9001, B Corp (comma separated)" defaultValue={editing?.certifications.join(', ')} />
          <div><div className="mb-2 text-xs font-bold text-[#40584c]">Supplier scorecard <span className="font-normal text-[#879088]">· 1 to 10</span></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Field name="price" label="Price" type="number" min="1" max="10" step="0.1" defaultValue={editing?.price ?? 7} required /><Field name="quality" label="Quality" type="number" min="1" max="10" step="0.1" defaultValue={editing?.quality ?? 7} required /><Field name="delivery" label="Delivery" type="number" min="1" max="10" step="0.1" defaultValue={editing?.delivery ?? 7} required /><Field name="reliability" label="Reliability" type="number" min="1" max="10" step="0.1" defaultValue={editing?.reliability ?? 7} required /></div><p className="mt-2 text-[11px] text-[#8a948b]">Score each dimension against your internal supplier record. Price uses the same 1–10 rubric scale.</p></div>
          <div className="flex justify-end gap-2 border-t border-[#eeeae2] pt-4"><Button variant="secondary" onClick={() => { setAdding(false); setEditing(null); }} testId="button-cancel-supplier">Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending} testId="button-save-supplier">{create.isPending || update.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}{editing ? 'Save changes' : 'Add supplier'}</Button></div>
        </form>
      </div>
    </div>}
  </QueryState>;
}

function Field({ name, label, placeholder, defaultValue, required = false, type = 'text', min, max, step }: { name: string; label: string; placeholder?: string; defaultValue?: string | number; required?: boolean; type?: string; min?: string; max?: string; step?: string }) {
  return <label className="block text-xs font-semibold text-[#52665a]">{label}<input name={name} type={type} min={min} max={max} step={step} required={required} placeholder={placeholder} defaultValue={defaultValue}
    className="mt-1.5 h-10 w-full rounded-xl border border-[#dedbd1] bg-[#fbfaf6] px-3 text-sm font-normal text-[#30483f] placeholder:text-[#a3a79e]" /></label>;
}

function ScorePill({ value }: { value: number }) {
  return <span data-testid="supplier-score" className={`mono inline-flex min-w-9 justify-center rounded-lg px-2 py-1 text-xs font-medium ${value >= 8 ? 'bg-[#e8f0e7] text-[#3e7455]' : value >= 6 ? 'bg-[#f3efe2] text-[#8c7448]' : 'bg-[#f8e8e2] text-[#a24c3d]'}`}>{value.toFixed(1)}</span>;
}

function CriteriaPage() {
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const query = useGetCriteria();
  const update = useUpdateCriteria();
  const run = useCreateEvaluation();
  const [rules, setRules] = useState<CriteriaRule[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { if (query.data) setRules(query.data.criteria.map(rule => ({ ...rule }))); }, [query.data]);
  const enabledRules = rules.filter(rule => rule.enabled);
  const weightTotal = enabledRules.reduce((sum, rule) => sum + Number(rule.weight), 0);
  const patch = (key: CriteriaRule['key'], changes: Partial<CriteriaRule>) => setRules(current => current.map(rule => rule.key === key ? { ...rule, ...changes } : rule));
  const save = () => {
    setError(''); setMessage('');
    const data: CriteriaSetInput = { criteria: rules };
    update.mutate({ data }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getGetCriteriaQueryKey() }); setMessage('Rubric saved. This version will be captured in your next report.'); }, onError: err => setError(errorText(err)) });
  };
  const runEvaluation = () => {
    setError(''); setMessage('');
    if (!enabledRules.length) { setError('Enable at least one criterion before running an evaluation.'); return; }
    if (weightTotal !== 100) { setError('Enabled criterion weights must total exactly 100%. Adjust the weights before you run.'); return; }
    run.mutate(undefined, { onSuccess: evaluation => {
      void Promise.all([client.invalidateQueries({ queryKey: getGetEvaluationsQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), client.invalidateQueries({ queryKey: getGetActivityQueryKey() })]);
      setLocation(`/evaluations/${evaluation.id}`);
    }, onError: err => setError(errorText(err)) });
  };
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <SectionTitle eyebrow="Decision rubric · 03" title="Set the terms of comparison." note="Weights decide how much each dimension matters. Cutoffs remove suppliers that do not meet a minimum." action={<span className="rounded-full border border-[#ded9ca] bg-[#f0ede4] px-3 py-1.5 text-[11px] font-semibold text-[#718077]">Version {query.data?.version ?? '—'}</span>} />
    {message && <div role="status" data-testid="status-criteria-success" className="mb-4 rounded-xl border border-[#c6dacb] bg-[#edf4ec] px-4 py-3 text-sm text-[#386a4d]">{message}</div>}
    {error && <InlineError>{error}</InlineError>}
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Panel className="overflow-hidden">
        <div className="border-b border-[#ebe7de] px-5 py-4 sm:px-6"><div className="display-font font-bold text-[#30483f]">Scoring dimensions</div><p className="mt-1 text-xs text-[#879188]">Each supplier score is evaluated from 1 to 10.</p></div>
        <div className="divide-y divide-[#eeeae2]">{rules.map(rule => <div key={rule.key} data-testid={`criteria-rule-${rule.key}`} className={`grid gap-4 px-5 py-5 transition sm:grid-cols-[minmax(160px,1fr)_140px_130px] sm:items-center sm:px-6 ${rule.enabled ? '' : 'opacity-55'}`}>
          <div className="flex gap-3"><button type="button" onClick={() => patch(rule.key, { enabled: !rule.enabled })} aria-pressed={rule.enabled} aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.label}`} data-testid={`toggle-criterion-${rule.key}`} className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${rule.enabled ? 'bg-[#3b755e]' : 'bg-[#c9c8be]'}`}><span className={`h-4 w-4 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-4' : ''}`} /></button><div><div className="text-sm font-bold text-[#3b5247]">{rule.label}</div><div className="mt-1 text-xs leading-5 text-[#88938a]">{rule.hint}</div></div></div>
          <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#89938b]">Weight <span className="mono ml-1 text-sm normal-case tracking-normal text-[#344d42]">{rule.weight}%</span><input type="range" min="0" max="100" step="1" disabled={!rule.enabled} value={rule.weight} onChange={e => patch(rule.key, { weight: Number(e.target.value) })} aria-label={`${rule.label} weight`} data-testid={`input-weight-${rule.key}`} className="mt-2 block h-1.5 w-full cursor-pointer accent-[#34705a] disabled:cursor-not-allowed" /></label>
          <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#89938b]">Minimum score <span className="text-[#a0a59e]">· cutoff</span><div className="mt-1.5 flex items-center gap-2"><input type="number" min="0" max="10" step=".5" disabled={!rule.enabled} value={rule.cutoff} onChange={e => patch(rule.key, { cutoff: Number(e.target.value) })} aria-label={`${rule.label} minimum score`} data-testid={`input-cutoff-${rule.key}`} className="h-9 w-[72px] rounded-lg border border-[#dedbd1] bg-[#fbfaf6] px-2 text-sm text-[#344d42] disabled:opacity-50" /><span className="text-xs text-[#929b92]">/ 10</span></div></label>
        </div>)}</div>
        <div className="flex flex-col gap-3 border-t border-[#ebe7de] bg-[#faf9f4] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className={`flex items-center gap-2 text-xs font-semibold ${weightTotal === 100 ? 'text-[#4b795f]' : 'text-[#ae6846]'}`}><span className={`flex h-6 w-6 items-center justify-center rounded-full ${weightTotal === 100 ? 'bg-[#e3eee3]' : 'bg-[#f5e8d9]'}`}>{weightTotal === 100 ? <Check size={13} /> : <span className="mono">{weightTotal}</span>}</span>Weights sum to {weightTotal}% <span className="font-normal text-[#919a91]">· must equal 100%</span></div><Button variant="secondary" onClick={save} disabled={update.isPending || !rules.length} testId="button-save-criteria">{update.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Save rubric</Button></div>
      </Panel>
      <div className="space-y-5">
        <Panel className="overflow-hidden"><div className="bg-[#203936] p-5 text-[#f5f1e5]"><div className="mb-4 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.18em] text-[#adc1b1]">Ready to compare?</span><Sparkles size={16} className="text-[#e2a36a]" /></div><div className="display-font text-[36px] font-bold tracking-[-.06em]">{enabledRules.length}<span className="ml-1 text-lg font-medium text-[#9bb0a2]">criteria</span></div><p className="mt-2 text-xs leading-5 text-[#b6c7b8]">{weightTotal === 100 ? 'The current rubric is balanced and ready.' : 'Set enabled weights to 100% to run a fair comparison.'}</p><Button onClick={runEvaluation} disabled={run.isPending || weightTotal !== 100 || !enabledRules.length} testId="button-run-evaluation" className="mt-5 w-full bg-[#e2a36a] text-[#273b31] hover:bg-[#edb37d]">{run.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Zap size={15} />}Run evaluation</Button></div><div className="p-4 text-[11px] leading-5 text-[#818d83]">The evaluation and criteria snapshot are saved as a report. No supplier record is written to a blockchain.</div></Panel>
        <Panel className="p-5"><div className="flex gap-3"><Shield size={17} className="mt-0.5 shrink-0 text-[#68816f]" /><div><div className="text-xs font-bold text-[#3e594b]">Cutoffs are hard gates</div><p className="mt-1.5 text-xs leading-5 text-[#7f8a81]">A supplier below any enabled minimum is disqualified before weighted scoring. Disabled criteria do not affect the result.</p></div></div></Panel>
      </div>
    </div>
  </QueryState>;
}

function EvaluationsPage() {
  const query = useGetEvaluations();
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <SectionTitle eyebrow="Decision archive · 04" title="Reports you can return to." note="Each report preserves the rubric and supplier scores used at decision time, even as your supplier pool changes."
      action={<Link href="/criteria" data-testid="link-new-evaluation" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#20594d] px-4 text-sm font-semibold text-white hover:bg-[#17463d]"><Zap size={15} />New evaluation</Link>} />
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#ebe7de] px-5 py-4 sm:px-6"><div><div className="display-font font-bold text-[#30483f]">Saved decision reports</div><p className="mt-1 text-xs text-[#879188]">{query.data?.length || 0} records · newest first</p></div><span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#718077]"><ShieldCheck size={14} />Private records</span></div>
      {query.data?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead><tr className="bg-[#f8f6ef] text-[10px] font-bold uppercase tracking-[.12em] text-[#8b948b]"><th className="px-5 py-3">Decision</th><th className="px-4 py-3">Evaluated</th><th className="px-4 py-3">Participants</th><th className="px-4 py-3">Winner score</th><th className="px-4 py-3">Integrity</th><th className="px-5 py-3 text-right">Report</th></tr></thead>
        <tbody className="divide-y divide-[#eeeae2]">{query.data.map(report => <tr data-testid={`row-evaluation-${report.id}`} key={report.id} className="transition hover:bg-[#fbfaf6]">
          <td className="px-5 py-4"><Link href={`/evaluations/${report.id}`} className="text-sm font-semibold text-[#354f43] hover:text-[#4b8061]">{report.winnerName || 'No qualified supplier'}</Link><div className="mono mt-1 text-[10px] text-[#9aa096]">REPORT · {String(report.id).padStart(5, '0')}</div></td>
          <td className="px-4 py-4 text-xs text-[#77837a]">{fmtDate(report.createdAt)}</td><td className="px-4 py-4 text-xs text-[#77837a]">{report.qualifiedCount} / {report.supplierCount} qualified</td>
          <td className="px-4 py-4"><span className="mono text-sm font-medium text-[#3c5549]">{report.winnerScore == null ? '—' : report.winnerScore.toFixed(2)}</span><span className="ml-1 text-[10px] text-[#9ba096]">/ 10</span></td>
          <td className="px-4 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${report.anchor ? 'bg-[#e8f0e7] text-[#4b795f]' : 'bg-[#f3efe3] text-[#8b774f]'}`}>{report.anchor ? <ShieldCheck size={12} /> : <Clock3 size={12} />}{report.anchor ? 'Anchored' : 'Saved'}</span></td>
          <td className="px-5 py-4 text-right"><Link href={`/evaluations/${report.id}`} data-testid={`link-open-evaluation-${report.id}`} aria-label={`Open report ${report.id}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6c8072] hover:bg-[#e9eee6]"><ArrowUpRight size={16} /></Link></td>
        </tr>)}</tbody></table></div> : <EmptyState icon={FileCheck2} title="The archive is waiting" body="Once you run an evaluation, the full ranking, criteria snapshot, and decision notes will live here." action={<Link href="/criteria" className="text-sm font-bold text-[#36705d]">Set up your first evaluation <ArrowRight size={14} className="ml-1 inline" /></Link>} />}
    </Panel>
  </QueryState>;
}

function EvaluationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const query = useGetEvaluation(id, { query: { enabled: Number.isFinite(id) && id > 0, queryKey: getGetEvaluationQueryKey(id) } });
  const client = useQueryClient();
  const saveAnchor = useSaveEvaluationAnchor();
  const [anchorError, setAnchorError] = useState('');
  const [anchorSuccess, setAnchorSuccess] = useState('');
  const [anchoring, setAnchoring] = useState(false);
  const [verified, setVerified] = useState(false);
  const [recovery, setRecovery] = useState<{ data: EvaluationAnchorInput; transactionHash: string } | null>(null);
  const report = query.data;
  const eligible = report?.ranked || [];
  const ranked = [...eligible].sort((a, b) => b.score - a.score);
  const qualified = report?.qualifiedCount || 0;
  const hasAnchor = !!report?.anchor;
  const verifyOnChain = async (data: EvaluationAnchorInput, current: Evaluation) => {
    if (!window.ethereum) throw new Error('No browser wallet provider is available. Connect a wallet such as MetaMask and try again.');
    const provider = new BrowserProvider(window.ethereum as never);
    const network = await provider.getNetwork();
    if (network.chainId !== 11155111n) throw new Error('Switch your wallet to Sepolia (chain ID 11155111) before verifying this report.');
    if (data.chainId !== 11155111) throw new Error('This proof is not recorded for Sepolia.');
    const contract = new Contract(data.contractAddress, anchorAbi, provider);
    const recomputed = reportDigest(current, getBytes(data.verificationSalt));
    if (recomputed.toLowerCase() !== data.reportHash.toLowerCase()) throw new Error('The report digest does not match the saved report and verification salt.');
    const stored = await contract.anchors(BigInt(current.id)) as string;
    if (stored.toLowerCase() !== recomputed.toLowerCase()) throw new Error('The contract registry does not contain the expected digest for this evaluation number.');
    return recomputed;
  };
  const invalidateReportViews = () => Promise.all([
    client.invalidateQueries({ queryKey: getGetEvaluationQueryKey(id) }),
    client.invalidateQueries({ queryKey: getGetEvaluationsQueryKey() }),
    client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
    client.invalidateQueries({ queryKey: getGetActivityQueryKey() }),
  ]);
  const verifySavedAnchor = async () => {
    if (!report?.anchor) return;
    setAnchorError(''); setAnchorSuccess('');
    try {
      const proof: EvaluationAnchorInput = {
        reportHash: report.anchor.reportHash,
        verificationSalt: report.anchor.verificationSalt,
        transactionHash: report.anchor.transactionHash,
        contractAddress: report.anchor.contractAddress,
        evaluatorAddress: report.anchor.evaluatorAddress,
        chainId: report.anchor.chainId,
        blockNumber: report.anchor.blockNumber,
      };
      await verifyOnChain(proof, report);
      setVerified(true);
      setAnchorSuccess('Verified: the salted report digest matches the Sepolia registry for this evaluation.');
    } catch (error) {
      setVerified(false);
      setAnchorError(errorText(error));
    }
  };
  const startAnchor = async () => {
    if (!report) return;
    setAnchorError(''); setAnchorSuccess(''); setRecovery(null); setVerified(false);
    if (report.anchor) { setAnchorError('This evaluation already has saved anchor metadata. Verify the existing proof instead.'); return; }
    const address = (localStorage.getItem('supplier-select-contract') || contractFromEnv || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { setAnchorError('Configure a valid Sepolia contract address in Settings before anchoring this report.'); return; }
    if (!window.ethereum) { setAnchorError('No browser wallet provider was found. Install or enable a wallet, then retry.'); return; }
    setAnchoring(true);
    let txHash = '';
    let chainConfirmed = false;
    let apiAttempted = false;
    let apiSaved = false;
    let proofData: EvaluationAnchorInput | null = null;
    try {
      const provider = new BrowserProvider(window.ethereum as never);
      const accounts = await provider.send('eth_requestAccounts', []) as string[];
      if (!accounts?.length) throw new Error('The wallet did not provide an account. Connect an account and try again.');
      const network = await provider.getNetwork();
      if (network.chainId !== 11155111n) throw new Error('Your wallet is not on Sepolia. Switch networks in Settings or your wallet, then retry.');
      const signer = await provider.getSigner(accounts[0]);
      const evaluatorAddress = await signer.getAddress();
      const contract = new Contract(address, anchorAbi, signer);
      const previous = await contract.anchors(BigInt(report.id)) as string;
      if (previous !== `0x${'0'.repeat(64)}`) throw new Error('The contract already has an anchor for this evaluation number. Verify the existing on-chain record instead of submitting a duplicate.');
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const verificationSalt = hexlify(saltBytes);
      const reportHash = reportDigest(report, saltBytes);
      const transaction = await contract.anchor(BigInt(report.id), reportHash);
      txHash = transaction.hash as string;
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`The Sepolia transaction did not succeed. Review transaction ${txHash} in Etherscan before retrying.`);
      chainConfirmed = true;
      const data: EvaluationAnchorInput = {
        reportHash,
        verificationSalt,
        transactionHash: txHash,
        contractAddress: address,
        evaluatorAddress,
        chainId: 11155111,
        blockNumber: Number(receipt.blockNumber),
      };
      proofData = data;
      apiAttempted = true;
      await saveAnchor.mutateAsync({ id, data });
      apiSaved = true;
      await invalidateReportViews();
      await verifyOnChain(data, report);
      setVerified(true);
      setAnchorSuccess('Verified on Sepolia and saved to the report. The registry digest matches this report.');
    } catch (error) {
      setVerified(false);
      if (chainConfirmed && txHash && proofData && apiAttempted && !apiSaved) {
        setRecovery({ data: proofData, transactionHash: txHash });
        setAnchorError(`The Sepolia transaction succeeded, but saving its proof metadata to SupplierSelect failed. Transaction: ${txHash}. Use “Retry saving metadata” below; do not submit another anchor transaction.`);
      } else if (chainConfirmed && txHash && proofData) {
        setAnchorError(`The chain transaction succeeded (${txHash}), but post-save verification did not complete. Retry verification after checking the report and network.`);
        void invalidateReportViews();
      } else {
        setAnchorError(errorText(error));
      }
    } finally {
      setAnchoring(false);
    }
  };
  const retrySaveMetadata = async () => {
    if (!recovery || !report) return;
    setAnchorError(''); setAnchorSuccess(''); setAnchoring(true);
    try {
      await saveAnchor.mutateAsync({ id, data: recovery.data });
      await invalidateReportViews();
      await verifyOnChain(recovery.data, report);
      setVerified(true);
      setRecovery(null);
      setAnchorSuccess('Proof metadata saved and verified against the Sepolia registry.');
    } catch (error) {
      setAnchorError(`Recovery is not complete. Transaction ${recovery.transactionHash} is already on-chain. ${errorText(error)}`);
    } finally {
      setAnchoring(false);
    }
  };
  return <QueryState loading={query.isLoading} error={query.error || (!Number.isFinite(id) ? new Error('Invalid report identifier.') : undefined)} onRetry={() => query.refetch()}>
    {report && <div>
      <Link href="/evaluations" data-testid="link-back-evaluations" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-[#708076] hover:text-[#345f4e]"><ArrowLeft size={14} />All reports</Link>
      <SectionTitle eyebrow={`Saved report · ${String(report.id).padStart(5, '0')}`} title={report.winnerName || 'No qualified supplier'} note={`Evaluation run ${fmtDate(report.createdAt)} · ${report.supplierCount} suppliers considered across ${report.criteriaCount} criteria`}
        action={<span className={`rounded-full px-3 py-2 text-[11px] font-bold ${verified ? 'bg-[#e7f0e7] text-[#4b795f]' : 'bg-[#f4eedf] text-[#8d794f]'}`}>{verified ? 'Verified on Sepolia' : hasAnchor ? 'Proof saved · verify' : 'Off-chain report'}</span>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Metric label="Winner score" value={report.winnerScore == null ? '—' : report.winnerScore.toFixed(2)} detail="Weighted score out of 10" icon={Trophy} color="orange" />
        <Metric label="Qualified" value={`${qualified} / ${report.supplierCount}`} detail="Passed every enabled cutoff" icon={BadgeCheck} />
        <Metric label="Criteria used" value={report.criteriaCount} detail="Captured with this report" icon={SlidersHorizontal} color="blue" />
      </div>
      {anchorSuccess && <div role="status" data-testid="status-anchor-success" className="mb-4 rounded-xl border border-[#c6dacb] bg-[#edf4ec] px-4 py-3 text-sm text-[#386a4d]">{anchorSuccess}</div>}
      {anchorError && <InlineError>{anchorError}</InlineError>}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#ebe7de] px-5 py-4 sm:px-6"><div><div className="display-font font-bold text-[#30483f]">Qualified ranking</div><p className="mt-1 text-xs text-[#879188]">Weighted performance for suppliers who passed all cutoffs</p></div><span className="mono text-xs text-[#829087]">SCORE / 10</span></div>
            {ranked.length ? <div className="divide-y divide-[#eeeae2]">{ranked.map((supplier, index) => <div key={supplier.id} data-testid={`ranking-row-${supplier.id}`} className={`grid grid-cols-[36px_minmax(130px,1fr)_minmax(100px,1.2fr)_58px] items-center gap-3 px-4 py-4 sm:grid-cols-[44px_minmax(160px,1fr)_minmax(140px,1.2fr)_70px] sm:px-6 ${index === 0 ? 'bg-[#f7f7ee]' : ''}`}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold ${index === 0 ? 'bg-[#e9b171] text-[#413b2e]' : 'bg-[#efeee7] text-[#78847a]'}`}>{String(index + 1).padStart(2, '0')}</div>
              <div className="min-w-0"><div className="truncate text-sm font-bold text-[#354d41]">{supplier.name}</div><div className="mt-1 truncate text-[10px] text-[#929a91]">{supplier.code} · {supplier.location}</div></div>
              <div><div className="h-2 overflow-hidden rounded-full bg-[#e8e8dc]"><div className={`h-full rounded-full ${index === 0 ? 'bg-[#4e8064]' : 'bg-[#a5b9a3]'}`} style={{ width: `${Math.min(100, supplier.score * 10)}%` }} /></div><div className="mt-1.5 flex justify-between text-[9px] text-[#98a097]"><span>Weighted result</span><span>{supplier.failedCriteria?.length || 0} cutoff misses</span></div></div>
              <div className="text-right"><span className="mono text-sm font-semibold text-[#39574a]">{supplier.score.toFixed(2)}</span>{index === 0 && <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-[#ad7744]">Top</div>}</div>
            </div>)}</div> : <EmptyState icon={Trophy} title="No suppliers qualified" body="Every supplier fell below at least one enabled cutoff in this report." />}
          </Panel>
          <Panel className="overflow-hidden">
            <div className="border-b border-[#ebe7de] px-5 py-4 sm:px-6"><div className="display-font font-bold text-[#30483f]">Criteria captured</div><p className="mt-1 text-xs text-[#879188]">The rubric at the time this report was created</p></div>
            {report.criteriaSnapshot.length ? <div className="grid gap-px bg-[#eeeae2] sm:grid-cols-2">{report.criteriaSnapshot.map(rule => <div key={rule.key} className="bg-[#fffdf8] p-4 sm:p-5"><div className="flex items-center justify-between"><div className="text-sm font-semibold text-[#40564b]">{rule.label}</div><span className="mono text-xs font-medium text-[#4c755e]">{rule.weight}%</span></div><p className="mt-1 text-[11px] text-[#879188]">{rule.hint}</p><div className="mt-3 flex items-center justify-between text-[10px] text-[#8f988f]"><span>Minimum cutoff</span><span className="mono text-[#52685b]">{rule.cutoff} / 10</span></div></div>)}</div> : <div className="p-6 text-sm text-[#879188]">Criteria snapshot was not included in this report.</div>}
          </Panel>
          {!!report.disqualified.length && <Panel className="overflow-hidden"><div className="border-b border-[#ebe7de] px-5 py-4"><div className="display-font font-bold text-[#30483f]">Did not meet the bar</div><p className="mt-1 text-xs text-[#879188]">{report.disqualified.length} supplier{report.disqualified.length !== 1 ? 's' : ''} disqualified by cutoff</p></div><div className="divide-y divide-[#eeeae2]">{report.disqualified.map(s => <div key={s.id} data-testid={`disqualified-row-${s.id}`} className="flex flex-col justify-between gap-2 px-5 py-3 sm:flex-row sm:items-center"><div><div className="text-sm font-semibold text-[#58695f]">{s.name}</div><div className="mt-1 text-[10px] text-[#929a91]">{s.code} · score {s.score.toFixed(2)}</div></div><div className="flex flex-wrap gap-1.5">{s.failedCriteria.map(item => <span key={item} className="inline-flex items-center gap-1 rounded-full bg-[#f8eae5] px-2.5 py-1 text-[10px] font-semibold text-[#a25140]"><XCircle size={11} />{item}</span>)}</div></div>)}</div></Panel>}
        </div>
        <aside className="space-y-5">
          <Panel className="overflow-hidden"><div className="flex items-center gap-3 border-b border-[#ebe7de] px-5 py-4"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf1e8] text-[#51755d]"><Fingerprint size={18} /></div><div><div className="display-font font-bold text-[#30483f]">Report integrity</div><div className="text-[10px] text-[#8c958b]">Supplier details remain private</div></div></div>
            {report.anchor ? <div className="p-5"><div className={`mb-3 flex items-center gap-2 text-xs font-bold ${verified ? 'text-[#4e795f]' : 'text-[#987445]'}`}>{verified ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{verified ? 'On-chain proof verified' : 'Proof metadata saved · verification needed'}</div><div className="space-y-3 text-[11px]"><DataValue label="Network" value="Sepolia · chain 11155111" /><DataValue label="Report hash" value={report.anchor.reportHash} copy /><DataValue label="Verification salt" value={report.anchor.verificationSalt} copy /><DataValue label="Transaction" value={report.anchor.transactionHash} copy /><DataValue label="Contract" value={report.anchor.contractAddress} copy /><DataValue label="Evaluator" value={report.anchor.evaluatorAddress} copy /><DataValue label="Block" value={String(report.anchor.blockNumber)} /><DataValue label="Anchored" value={fmtTime(report.anchor.anchoredAt)} /></div><a href={`https://sepolia.etherscan.io/tx/${report.anchor.transactionHash}`} target="_blank" rel="noreferrer" data-testid="link-explorer-transaction" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#45745d] hover:underline">View transaction on Etherscan <ArrowUpRight size={13} /></a><Button variant="secondary" onClick={verifySavedAnchor} disabled={anchoring || saveAnchor.isPending} testId="button-verify-anchor" className="mt-4 w-full">{anchoring ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldCheck size={15} />}{verified ? 'Verify again' : 'Verify on Sepolia'}</Button><p className="mt-3 border-t border-[#eeeae2] pt-3 text-[10px] leading-5 text-[#909990]">Verification recomputes the salted digest from this report and checks the contract registry for this evaluation number.</p></div> :
              <div className="p-5"><div className="rounded-xl bg-[#f6f3ea] p-3 text-xs leading-5 text-[#7b867c]"><ShieldCheck size={15} className="mr-1 inline text-[#8e9a78]" />Only a salted digest and evaluation number are put on-chain. Supplier names, scores, pricing, and report details are never submitted.</div><div className="mt-4 rounded-xl border border-[#e8e4d9] bg-[#fbfaf6] p-3"><div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#89948a]">Configured contract</div><div className="mono mt-1 break-all text-[10px] text-[#586c5e]">{localStorage.getItem('supplier-select-contract') || contractFromEnv || 'Not configured'}</div></div><Button onClick={startAnchor} disabled={anchoring || saveAnchor.isPending} testId="button-anchor-evaluation" className="mt-4 w-full">{anchoring || saveAnchor.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Link2 size={15} />}Anchor report on Sepolia</Button><p className="mt-3 text-[10px] leading-5 text-[#909990]">A random verification salt protects the report fingerprint. You will confirm the transaction in your wallet.</p></div>}
          </Panel>
          {recovery && <Panel className="border-[#e8c8ae] bg-[#fffaf3] p-5"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#98643f]"><CircleHelp size={15} />Transaction succeeded; API save needs retry</div><p className="text-[11px] leading-5 text-[#7d796d]">The chain proof is already confirmed. Do not anchor again. Retry saving the transaction metadata below to complete the report record.</p><DataValue label="Recovery transaction" value={recovery.transactionHash} copy /><Button onClick={retrySaveMetadata} disabled={anchoring || saveAnchor.isPending} testId="button-retry-anchor-save" className="mt-3 w-full">{anchoring || saveAnchor.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Retry saving metadata</Button></Panel>}
          <Panel className="p-5"><div className="flex gap-3"><Coins size={16} className="mt-0.5 shrink-0 text-[#ae8052]" /><div><div className="text-xs font-bold text-[#40594b]">What gets recorded?</div><p className="mt-1.5 text-[11px] leading-5 text-[#838e84]">The contract receives only the evaluation number and SHA-256 digest. A random 32-byte salt stays with the private report record to prevent supplier details from being inferred on-chain.</p></div></div></Panel>
        </aside>
      </div>
    </div>}
  </QueryState>;
}

function DataValue({ label, value, copy = false }: { label: string; value: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); } };
  return <div><div className="mb-1 text-[9px] font-bold uppercase tracking-[.13em] text-[#929b92]">{label}</div><div className="flex items-start gap-2"><span data-testid={`anchor-${label.toLowerCase().replaceAll(' ', '-')}`} className="mono min-w-0 flex-1 break-all text-[10px] leading-4 text-[#52685b]">{value}</span>{copy && <button type="button" onClick={doCopy} aria-label={`Copy ${label}`} data-testid={`button-copy-${label.toLowerCase().replaceAll(' ', '-')}`} className="shrink-0 text-[#7b8b7f] hover:text-[#345f4e]">{copied ? <Check size={13} /> : <Clipboard size={13} />}</button>}</div></div>;
}

function ActivityPage() {
  const query = useGetActivity({ limit: 100 });
  const [filter, setFilter] = useState('all');
  const options = [
    ['all', 'All events'], ['supplier', 'Suppliers'], ['criteria', 'Rubric'], ['evaluation', 'Evaluations'], ['anchor', 'Anchors'],
  ];
  const rows = (query.data || []).filter(item => filter === 'all' || (filter === 'supplier' ? item.eventType.startsWith('supplier_') : filter === 'criteria' ? item.eventType === 'criteria_updated' : filter === 'anchor' ? item.eventType === 'evaluation_anchored' : item.eventType.startsWith('evaluation_')));
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <SectionTitle eyebrow="Workspace history · 05" title="Every change, in context." note="A chronological record of supplier updates, evaluation decisions, and report anchors."
      action={<span className="inline-flex items-center gap-2 rounded-full border border-[#ded9ca] bg-[#f0ede4] px-3 py-2 text-[11px] font-semibold text-[#718077]"><ShieldCheck size={14} />Audit trail</span>} />
    <Panel className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-[#ebe7de] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><div className="display-font font-bold text-[#30483f]">Activity log</div><p className="mt-1 text-xs text-[#879188]">{rows.length} events shown · up to 100 most recent</p></div>
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#efede5] p-1">{options.map(([key, label]) => <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key} data-testid={`filter-activity-${key}`} className={`shrink-0 rounded-lg px-3 py-2 text-[10px] font-semibold transition ${filter === key ? 'bg-[#fffdf8] text-[#385c4b] shadow-sm' : 'text-[#828b82] hover:text-[#405a4d]'}`}>{label}</button>)}</div>
    </div>
    {rows.length ? <div className="divide-y divide-[#eeeae2]">{rows.map(item => <ActivityRow key={item.id} item={item} />)}</div> : <EmptyState icon={ActivityIcon} title={filter === 'all' ? 'No activity to show' : `No ${options.find(o => o[0] === filter)?.[1].toLowerCase()} events`} body="Changes made in this workspace appear here as they happen." />}
    </Panel>
  </QueryState>;
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: EthereumProvider } }

function SettingsPage() {
  const [contract, setContract] = useState(() => localStorage.getItem('supplier-select-contract') || contractFromEnv || '');
  const [saved, setSaved] = useState(false);
  const [wallet, setWallet] = useState('');
  const [chainId, setChainId] = useState('');
  const [walletError, setWalletError] = useState('');
  const [configError, setConfigError] = useState('');
  useEffect(() => {
    if (!window.ethereum) return;
    void window.ethereum.request({ method: 'eth_accounts' }).then(result => {
      const accounts = result as string[];
      if (accounts?.[0]) setWallet(accounts[0]);
    }).catch(() => undefined);
    void window.ethereum.request({ method: 'eth_chainId' }).then(result => setChainId(String(result))).catch(() => undefined);
    const onAccountsChanged = (...args: unknown[]) => setWallet((args[0] as string[] | undefined)?.[0] || '');
    const onChainChanged = (...args: unknown[]) => setChainId(String(args[0] || ''));
    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', onChainChanged);
  }, []);
  const saveConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConfigError('');
    if (contract.trim() && !/^0x[0-9a-fA-F]{40}$/.test(contract.trim())) { setConfigError('Enter a valid 20-byte Ethereum contract address, or leave it blank.'); return; }
    localStorage.setItem('supplier-select-contract', contract.trim());
    setSaved(true); window.setTimeout(() => setSaved(false), 2500);
  };
  const connect = async () => {
    setWalletError('');
    if (!window.ethereum) { setWalletError('No compatible browser wallet was found. Install a wallet such as MetaMask, then refresh this page.'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      let chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      if (chain !== '0xaa36a7') {
        try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] }); }
        catch { setWalletError('Switch your wallet to Sepolia to use the verification network.'); }
        chain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      }
      setWallet(accounts?.[0] || ''); setChainId(chain);
    } catch (err) { setWalletError(errorText(err)); }
  };
  const disconnect = () => { setWallet(''); setChainId(''); };
  return <div>
    <SectionTitle eyebrow="Workspace configuration · 06" title="Verification, on your terms." note="SupplierSelect is useful without a wallet. Configure Sepolia only when you want a saved report to have a public integrity timestamp." />
    {walletError && <InlineError>{walletError}</InlineError>}
    {configError && <InlineError>{configError}</InlineError>}
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Panel className="overflow-hidden"><div className="flex items-center gap-3 border-b border-[#ebe7de] px-5 py-4 sm:px-6"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4eadc] text-[#9b7049]"><Link2 size={17} /></div><div><div className="display-font font-bold text-[#30483f]">Sepolia anchor settings</div><div className="text-[10px] text-[#8c958b]">Ethereum test network · chain ID 11155111</div></div></div>
          <form onSubmit={saveConfig} className="space-y-4 p-5 sm:p-6">
            <label className="block text-xs font-semibold text-[#52665a]">Anchor contract address <span className="font-normal text-[#929a91]">· optional</span><input value={contract} onChange={e => setContract(e.target.value)} data-testid="input-contract-address" placeholder="0x… deployed Sepolia contract" className="mono mt-1.5 h-11 w-full rounded-xl border border-[#dedbd1] bg-[#fbfaf6] px-3 text-xs text-[#30483f] placeholder:font-sans placeholder:text-[#a3a79e]" /></label>
            <p className="text-xs leading-5 text-[#839087]">The address is saved in this browser only. It is not sent to SupplierSelect until you choose to record an existing on-chain transaction on a report.</p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eeeae2] pt-4"><span className={`text-xs font-medium ${contract ? 'text-[#4e795f]' : 'text-[#9a8664]'}`}>{contract ? 'Contract address configured locally' : 'No contract address configured'}</span><Button type="submit" variant="secondary" testId="button-save-settings">{saved ? <Check size={15} /> : <Check size={15} />}{saved ? 'Saved' : 'Save settings'}</Button></div>
          </form>
        </Panel>
        <Panel className="p-5 sm:p-6"><div className="flex items-start gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf0e9] text-[#547660]"><ShieldCheck size={19} /></div><div><div className="display-font font-bold text-[#30483f]">Privacy boundary</div><p className="mt-2 max-w-2xl text-xs leading-6 text-[#7e8a80]">Supplier names, scores, prices, locations, certifications, and report rankings remain in your procurement workspace. A blockchain record should contain only a salted report commitment and transaction metadata.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-[#edf2ea] p-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#57775f]">Stays private</div><div className="text-xs text-[#718077]">Supplier and evaluation detail</div></div><div className="rounded-xl bg-[#f5eee0] p-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#977650]">Public if anchored</div><div className="text-xs text-[#817b6e]">Hash, salt, timestamp, wallet address</div></div></div></div></div></Panel>
      </div>
      <div className="space-y-5">
        <Panel className="overflow-hidden"><div className="bg-[#203936] p-5 text-[#f5f1e5]"><div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[.17em] text-[#adc1b1]">Wallet connection</div><Wallet size={17} className="text-[#e2a36a]" /></div><div className="mt-4 display-font text-xl font-bold">{wallet ? 'Wallet connected' : 'No wallet connected'}</div><p className="mt-1.5 text-xs leading-5 text-[#b6c7b8]">{wallet ? chainId === '0xaa36a7' ? 'Connected to Sepolia test network.' : `Connected on chain ${chainId}.` : 'Connect when you are ready to work with an on-chain proof.'}</p>{wallet && <div className="mono mt-4 break-all rounded-lg bg-[#ffffff12] p-3 text-[10px] text-[#dce5d8]" data-testid="text-wallet-address">{wallet}</div>}
          <Button onClick={wallet ? disconnect : connect} testId={wallet ? 'button-disconnect-wallet' : 'button-connect-wallet'} className={`mt-5 w-full ${wallet ? 'bg-[#ffffff17] text-[#e5eee3] hover:bg-[#ffffff24]' : 'bg-[#e2a36a] text-[#273b31] hover:bg-[#edb37d]'}`}>{wallet ? <X size={15} /> : <Wallet size={15} />}{wallet ? 'Disconnect workspace view' : 'Connect wallet'}</Button>
        </div>
          <div className="p-5"><div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#40594b]"><span className={`h-2 w-2 rounded-full ${contract ? 'bg-[#6a9b72]' : 'bg-[#d3a16a]'}`} />Setup status</div><div className="space-y-2.5 text-xs"><SetupLine label="Sepolia network" ready={true} /><SetupLine label="Wallet session" ready={!!wallet && chainId === '0xaa36a7'} /><SetupLine label="Contract address" ready={!!contract} /><SetupLine label="Anchor contract interface" ready={!!contract} /></div></div>
        </Panel>
        <Panel className="p-5"><div className="display-font text-sm font-bold text-[#40584b]">Anchor with a private commitment</div><p className="mt-2 text-xs leading-5 text-[#838e84]">The configured registry receives only an evaluation number and salted digest. Supplier names and scores remain in the workspace. After a wallet transaction, SupplierSelect saves its receipt details and can verify the digest against the on-chain registry.</p></Panel>
      </div>
    </div>
  </div>;
}

function SetupLine({ label, ready }: { label: string; ready: boolean }) {
  return <div className="flex items-center justify-between"><span className="text-[#78857b]">{label}</span><span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${ready ? 'text-[#568060]' : 'text-[#a58b61]'}`}>{ready ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}{ready ? 'Ready' : 'Not set'}</span></div>;
}

function Router() {
  return <AppShell><Switch>
    <Route path="/" component={DashboardPage} />
    <Route path="/suppliers" component={SuppliersPage} />
    <Route path="/criteria" component={CriteriaPage} />
    <Route path="/evaluations" component={EvaluationsPage} />
    <Route path="/evaluations/:id" component={EvaluationDetailPage} />
    <Route path="/activity" component={ActivityPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></AppShell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><Router /></QueryClientProvider>;
}

export default App;
