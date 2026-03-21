import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, ExternalLink, Linkedin, ArrowUpDown, Building2, MapPin, Filter, Mail, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface ProspectCompany {
  id: string;
  company_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  specialties: string | null;
  certifications: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_linkedin: string | null;
  contact_email: string | null;
  employee_range: string | null;
  notes: string | null;
  outreach_email: string | null;
}

type SortField = "company_name" | "state" | "employee_range";
type SortDir = "asc" | "desc";

export default function Prospects() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("company_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedEmail, setSelectedEmail] = useState<ProspectCompany | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["prospect_companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_companies")
        .select("*")
        .order("company_name");
      if (error) throw error;
      return data as ProspectCompany[];
    },
  });

  const states = useMemo(
    () => [...new Set(companies.map((c) => c.state).filter(Boolean))].sort() as string[],
    [companies]
  );
  const sizes = useMemo(
    () => [...new Set(companies.map((c) => c.employee_range).filter(Boolean))].sort() as string[],
    [companies]
  );

  const filtered = useMemo(() => {
    let result = companies;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.company_name.toLowerCase().includes(q) ||
          c.specialties?.toLowerCase().includes(q) ||
          c.contact_name?.toLowerCase().includes(q) ||
          c.certifications?.toLowerCase().includes(q) ||
          c.city?.toLowerCase().includes(q)
      );
    }
    if (stateFilter !== "all") result = result.filter((c) => c.state === stateFilter);
    if (sizeFilter !== "all") result = result.filter((c) => c.employee_range === sizeFilter);

    return [...result].sort((a, b) => {
      const aVal = (a[sortField] || "").toString().toLowerCase();
      const bVal = (b[sortField] || "").toString().toLowerCase();
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [companies, search, stateFilter, sizeFilter, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const copyEmail = (company: ProspectCompany) => {
    if (!company.outreach_email) return;
    navigator.clipboard.writeText(company.outreach_email);
    setCopiedId(company.id);
    toast.success(`Email copied for ${company.company_name}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const parseEmail = (raw: string) => {
    const lines = raw.split("\n");
    const subjectLine = lines[0]?.startsWith("Subject:") ? lines[0].replace("Subject: ", "") : "";
    const body = lines.slice(1).join("\n").trim();
    return { subject: subjectLine, body };
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold text-muted-foreground hover:text-foreground" onClick={() => toggleSort(field)}>
      {children}<ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Prospect Companies
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filtered.length} of {companies.length} aerospace & industrial fabrication companies
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search company, specialty, contact, city..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-secondary/50 border-border" />
          </div>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[140px] bg-secondary/50 border-border">
              <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={sizeFilter} onValueChange={setSizeFilter}>
            <SelectTrigger className="w-[160px] bg-secondary/50 border-border">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sizes</SelectItem>
              {sizes.map((s) => (<SelectItem key={s} value={s}>{s} employees</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="px-6 py-4 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">Loading prospects…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[180px]"><SortButton field="company_name">Company</SortButton></TableHead>
                <TableHead className="w-[110px]"><SortButton field="state">Location</SortButton></TableHead>
                <TableHead className="w-[180px]">Specialties</TableHead>
                <TableHead className="w-[130px]">Certifications</TableHead>
                <TableHead className="w-[160px]">Key Contact</TableHead>
                <TableHead className="w-[90px]"><SortButton field="employee_range">Size</SortButton></TableHead>
                <TableHead className="w-[100px]">Outreach</TableHead>
                <TableHead className="w-[50px]">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="border-border hover:bg-secondary/30">
                  <TableCell className="font-medium text-sm">{c.company_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.city && c.state ? `${c.city}, ${c.state}` : c.state || "—"}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground line-clamp-2">{c.specialties || "—"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.certifications?.split(", ").map((cert) => (
                        <Badge key={cert} variant="secondary" className="text-[10px] px-1.5 py-0">{cert}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <div className="font-medium text-xs">{c.contact_name || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{c.contact_title}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] whitespace-nowrap">{c.employee_range || "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    {c.outreach_email ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-primary hover:text-primary"
                          onClick={() => setSelectedEmail(c)}
                        >
                          <Mail className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => copyEmail(c)}
                        >
                          {copiedId === c.id ? (
                            <Check className="h-3.5 w-3.5 text-accent" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {c.website && (
                        <a href={`https://${c.website}`} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Website">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {c.contact_linkedin && (
                        <a href={`https://${c.contact_linkedin}`} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="LinkedIn">
                          <Linkedin className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">No companies match your filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Email Preview Dialog */}
      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-primary" />
              Outreach Email — {selectedEmail?.company_name}
            </DialogTitle>
          </DialogHeader>
          {selectedEmail?.outreach_email && (() => {
            const { subject, body } = parseEmail(selectedEmail.outreach_email);
            return (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">TO</div>
                  <div className="text-sm">
                    {selectedEmail.contact_name} — {selectedEmail.contact_title}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">SUBJECT</div>
                  <div className="text-sm font-semibold">{subject}</div>
                </div>
                <div className="border border-border rounded-lg p-4 bg-secondary/30">
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{body}</div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    if (selectedEmail) copyEmail(selectedEmail);
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Full Email
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
