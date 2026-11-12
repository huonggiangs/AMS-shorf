#!/usr/bin/env python3
"""AMS - mo hinh chi phi ha tang / thang (Cloudflare vs ha tang rieng).

Chay:  python3 docs/cost-model/cost.py            # bang chinh 100k/1M/10M/50M
       python3 docs/cost-model/cost.py --sens      # + nhay cam
       python3 docs/cost-model/cost.py --md        # in dang Markdown
Don gia Cloudflare: nguon + ngay truy cap o docs/COST-MODEL.md muc 2 (truy cap 2026-11-12).
Moi tham so danh dau EST la uoc tinh cua tac gia, khong co nguon, phai do that o giai doan 1.
USD la don vi chinh. Khong gom VAT. Khong gom thue/chiet khau Enterprise.
"""
from __future__ import annotations
import math, argparse
from dataclasses import dataclass, field, replace

# ---------------------------------------------------------------- don gia Cloudflare (nguon: developers.cloudflare.com, 2026-11-12)
CF = dict(
    workers_base=5.0, workers_req_incl=10e6, workers_req_per_m=0.30,
    workers_cpu_incl_ms=30e6, workers_cpu_per_m_ms=0.02,
    queues_ops_incl=1e6, queues_per_m_ops=0.40, queues_ops_per_msg=3,   # write+read+delete
    do_req_incl=1e6, do_req_per_m=0.15, do_gbs_incl=400e3, do_gbs_per_m=12.50,
    do_rows_w_incl=50e6, do_rows_w_per_m=1.00, do_store_incl_gb=5, do_store_per_gb=0.20,
    kv_read_incl=10e6, kv_read_per_m=0.50, kv_write_incl=1e6, kv_write_per_m=5.00,
    d1_rows_w_incl=50e6, d1_rows_w_per_m=1.00, d1_rows_r_incl=25e9, d1_rows_r_per_m=0.001,
    r2_gb=0.015, r2_a_per_m=4.50, r2_b_per_m=0.36, r2_a_incl=1e6, r2_b_incl=10e6, r2_gb_incl=10,
    pipe_parquet_per_gb=0.06, pipe_incl_gb=50,
    ae_per_m_points=0.25,  # Analytics Engine: tai lieu ghi "billing not active yet" (2026-11-12)
)

@dataclass
class P:                      # tham so khoi luong (muc 3 dac ta) + gia dinh
    hb_s: int = 120           # chu ky heartbeat (dac ta)
    ev_s: int = 600           # chu ky gui lo su kien (dac ta: gop 10 phut)
    mf_s: int = 900           # poll manifest 15 phut (dac ta)
    online_h: float = 8.0     # EST gio online/ngay/thiet bi (dac ta chi cho dinh 18:00-21:30)
    imp_per_h: float = 8.0    # dac ta: ~8 luot/gio/TV
    cpu_hb_ms: float = 2.0    # EST CPU ms/heartbeat (xac minh Ed25519 + presence)
    cpu_ev_ms: float = 5.0    # EST
    cpu_mf_ms: float = 1.0    # EST
    kv_per_mf: float = 1.0    # EST doc KV cho moi poll manifest (etag)
    kv_per_hb: float = 0.1    # EST doc KV khoa cong khai, 90% trung cache isolate
    hb_row_b: int = 40        # EST byte/dong heartbeat chua nen
    imp_row_b: int = 100      # EST byte/dong impression chua nen
    parquet_ratio: float = 5  # EST ty le nen
    hb_keep_d: int = 14       # dac ta: TTL heartbeat 14 ngay
    imp_keep_m: int = 12      # dac ta: audit >=12 thang (EST gia han cho impression)
    snap_per_h: float = 60    # EST DO snapshot presence/phut/shard
    creatives_per_dev_day: float = 1.0   # EST
    creative_mb: float = 6.0             # EST
    bytes_per_req: int = 3000 # EST byte 2 chieu/request (TLS + header + body)
    mf_cdn: bool = False      # True: manifest phuc vu truc tiep tu CDN cache/R2 public, khong qua Worker
    media_tb: float = 2.0     # EST kho media tong
    design: str = "A"         # A: dac ta (hb+ev -> Queue); B: hb->DO, ev->Queue; C: hb->DO, ev->Pipelines truc tiep; D = C + manifest qua CDN
    admin_fixed: float = 60.0 # EST D1+Workers quan tri, phan co dinh/thang

# so DO hoat dong (shard logic 4096 trong DB co the gop nhieu shard vao 1 DO): ~10k thiet bi/DO, EST
SCALES = {"100k": (100_000, 16), "1M": (1_000_000, 128), "10M": (10_000_000, 1024), "50M": (50_000_000, 8192)}

def over(used, incl, per_m): return max(0.0, used - incl) / 1e6 * per_m

def volumes(n, p: P):
    dh = n * p.online_h * 30                      # thiet-bi-gio / thang
    hb = dh * 3600 / p.hb_s
    ev = dh * 3600 / p.ev_s
    mf = dh * 3600 / p.mf_s
    imps = dh * p.imp_per_h
    peak_rps = n * (1/p.hb_s + 1/p.ev_s + 1/p.mf_s)   # dinh: tat ca N online
    return dict(dh=dh, hb=hb, ev=ev, mf=mf, imps=imps, req=hb+ev+mf, peak_rps=peak_rps)

def cloudflare(n, shards, p: P):
    v = volumes(n, p); c = CF; L = {}
    if p.design == "D": v = dict(v); v["req"] -= v["mf"]; v["mf"] = 0.0
    L["Workers: phi co ban"] = c["workers_base"]
    L["Workers: request"] = over(v["req"], c["workers_req_incl"], c["workers_req_per_m"])
    cpu = v["hb"]*p.cpu_hb_ms + v["ev"]*p.cpu_ev_ms + v["mf"]*p.cpu_mf_ms
    L["Workers: CPU time"] = over(cpu, c["workers_cpu_incl_ms"], c["workers_cpu_per_m_ms"])
    qmsgs = {"A": v["hb"]+v["ev"], "B": v["ev"], "C": 0, "D": 0}[p.design]
    L["Queues"] = over(qmsgs*c["queues_ops_per_msg"], c["queues_ops_incl"], c["queues_per_m_ops"])
    L["Durable Objects: request (presence)"] = over(v["hb"], c["do_req_incl"], c["do_req_per_m"])
    gbs = shards * 0.128 * p.online_h * 3600 * 30      # 128 MB/doi tuong, luon thuc
    L["Durable Objects: duration"] = over(gbs, c["do_gbs_incl"], c["do_gbs_per_m"])
    rows_w = shards * p.snap_per_h * p.online_h * 30
    L["Durable Objects: SQLite rows written"] = over(rows_w, c["do_rows_w_incl"], c["do_rows_w_per_m"])
    kvr = v["mf"]*p.kv_per_mf + v["hb"]*p.kv_per_hb
    L["KV: doc"] = over(kvr, c["kv_read_incl"], c["kv_read_per_m"])
    L["KV: ghi/D1/quan tri (co dinh EST)"] = p.admin_fixed
    ev_gb = (v["hb"]*p.hb_row_b + v["imps"]*p.imp_row_b) / 1e9
    L["Pipelines: giao Parquet -> R2"] = max(0.0, ev_gb - c["pipe_incl_gb"]) * c["pipe_parquet_per_gb"]
    stored_gb = (v["hb"]*p.hb_row_b/1e9*p.hb_keep_d/30 + v["imps"]*p.imp_row_b/1e9*p.imp_keep_m) / p.parquet_ratio
    media_ops = n * p.creatives_per_dev_day * 30
    L["R2: luu tru (su kien + media)"] = max(0.0, stored_gb + p.media_tb*1000 - c["r2_gb_incl"]) * c["r2_gb"]
    L["R2: Class B (tai media)"] = over(media_ops, c["r2_b_incl"], c["r2_b_per_m"])
    L["Bang thong (R2/CDN egress mien phi)"] = 0.0
    return L, v, dict(stored_gb=stored_gb, ev_gb=ev_gb, media_pb=media_ops*p.creative_mb/1e9, do_rps=n/p.hb_s/shards)

# ---------------------------------------------------------------- ha tang rieng
@dataclass
class Site:
    name: str
    server_usd: float       # gia/thang 1 may
    threads: float          # luong hieu dung quy doi
    ram_gb: int
    disk_tb: float
    bw_usd_per_gbps: float  # chi phi bang thong/Gbps/thang
    note: str = ""

# Hetzner AX102: EUR 104/thang, 16 nhan, 128GB, ~3.75TB NVMe, 1G khong gioi han (whtop.com 2026-02, truy cap 2026-11-12). EUR->USD 1.10 EST.
EU = Site("EU Hetzner AX102 (tham chieu, xa VN)", 104*1.10, 32, 128, 3.5, 0.0, "RTT ~250-300ms tu VN (EST); khong dap ung luu tru trong nuoc")
# Vinahost Xeon 18 nhan 32GB: $344.25 (vinahost.vn, 2026-11-12) + RAM +64GB (8x$10) + SSD 1.92TB $65 -> ~$490; bang thong 900Mbps +$585 => ~$650/Gbps
VN = Site("VN bare-metal (Vinahost-class)", 344.25+80+65, 36*0.6, 96, 1.9, 585/0.9, "Xeon doi cu: hieu nang/luong ~0.6 so voi Zen4 (EST)")

def selfhosted(n, p: P, site: Site, staff_usd=3500.0):
    v = volumes(n, p); R = {}
    rps = v["peak_rps"]
    req_per_thread = 8000                     # EST req/s/luong cho gateway Go co TLS (khong dang tin neu chua do)
    headroom = 2.0                            # EST du phong dinh + mat vung
    gw = math.ceil(rps*headroom/req_per_thread/site.threads)
    hb_rps = n/p.hb_s; ev_rps = n/p.ev_s
    msg_mbps = (hb_rps*60 + ev_rps*400)*3/1e6          # EST 60B/hb, 400B/lo, nhan doi 3
    rp = max(3, math.ceil(msg_mbps/100))               # EST 100 MB/s/broker ben vung; toi thieu 3 de HA
    # luu tru ClickHouse
    stored_gb = (v["hb"]*p.hb_row_b/1e9*p.hb_keep_d/30 + v["imps"]*p.imp_row_b/1e9*p.imp_keep_m) / 5 * 2   # nen 5, nhan doi 2
    ch_rows = hb_rps + n*p.imp_per_h/3600                 # dong/s vao ClickHouse luc dinh
    ch = max(math.ceil(stored_gb/1000/site.disk_tb), math.ceil(ch_rows/300_000*1.0/ (site.threads/32)), 2)   # EST 300k dong/s/may Zen4
    redis = 2*max(1, math.ceil(hb_rps/80_000))        # EST 80k op/s/primary + 1 replica
    pg = 1 if n < 1e6 else (3 if n < 1e7 else 4)
    total = gw + rp + ch + redis + pg
    colo = n <= 1_000_000                              # nho: gop vai tro tren it may
    if colo: total = max(3, math.ceil(total/2))
    R["May chu (gateway/Redpanda/ClickHouse/Redis/Postgres)"] = total*site.server_usd
    gbps = rps*p.bytes_per_req*8/1e9
    R["Bang thong hot-path (dinh %.1f Gbps)" % gbps] = gbps*site.bw_usd_per_gbps
    R["Cloudflare CDN/WAF/R2 media (EST)"] = 200 + p.media_tb*1000*0.015 + over(n*p.creatives_per_dev_day*30, 10e6, 0.36)
    fte = 0.5 if n < 1e6 else (2 if n < 1e7 else (3 if n < 5e7 else 5))   # EST nhan su van hanh
    R["Nhan su van hanh (EST FTE x %.0f)" % staff_usd] = fte*staff_usd
    R["Khau hao chuyen doi (EST $60k / 24 thang)"] = 60000/24
    return R, dict(servers=total, gw=gw, rp=rp, ch=ch, redis=redis, pg=pg, gbps=gbps, stored_gb=stored_gb, fte=fte)

def tot(d): return sum(d.values())
def fmt(x): return f"{x:,.0f}"

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--sens", action="store_true"); ap.add_argument("--md", action="store_true")
    a = ap.parse_args()
    base = P()
    print("== Khoi luong dinh (khop muc 3 dac ta) ==")
    for k, (n, sh) in SCALES.items():
        v = volumes(n, base)
        print(f"{k:>5}: heartbeat {n/base.hb_s:>9,.0f}/s | lo su kien {n/base.ev_s:>8,.0f}/s | manifest {n/base.mf_s:>8,.0f}/s | tong {v['peak_rps']:>9,.0f} req/s | req/thang {v['req']/1e9:>8,.1f} ty (online {base.online_h:g}h/ngay)")
    print("\n== Cloudflare, tung dong, USD/thang (A = dac ta; B/C/D = toi uu dan, xem COST-MODEL.md) ==")
    results = {}
    for d in ("A", "B", "C", "D"):
        for k, (n, sh) in SCALES.items():
            L, v, x = cloudflare(n, sh, replace(base, design=d))
            results[(d, k)] = (L, v, x)
    keys = list(results[("A","100k")][0].keys())
    for d in ("A", "D"):
        print(f"\n-- design {d} --")
        print(f"{'Dong':<44}" + "".join(f"{k:>14}" for k in SCALES))
        for key in keys:
            print(f"{key:<44}" + "".join(f"{fmt(results[(d,k)][0][key]):>14}" for k in SCALES))
        print(f"{'TONG':<44}" + "".join(f"{fmt(tot(results[(d,k)][0])):>14}" for k in SCALES))
    print("\n== Tom tat Cloudflare: A / B / C / D (USD/thang) ==")
    for d in ("A","B","C","D"):
        print(f"design {d}: " + " | ".join(f"{k}: {fmt(tot(results[(d,k)][0]))}" for k in SCALES))
    print("\n== Ha tang rieng (hot-path; CF giu CDN/WAF/media) ==")
    sh_res = {}
    for site in (VN, EU):
        print(f"\n-- {site.name} -- {site.note}")
        for k, (n, sh) in SCALES.items():
            R, x = selfhosted(n, base, site); sh_res[(site.name, k)] = (R, x)
            print(f"{k:>5}: tong {fmt(tot(R)):>9} (chua nhan su/khau hao {fmt(tot(R)-sum(val for kk,val in R.items() if kk.startswith(("Nhan su","Khau hao")))):>9}) | may {x['servers']} (gw {x['gw']}, rp {x['rp']}, ch {x['ch']}, redis {x['redis']}, pg {x['pg']}) | {x['gbps']:.1f} Gbps | {x['stored_gb']/1000:.1f} TB CH | {x['fte']} FTE")
    print("\n== Chi phi / thiet bi / thang va / 1000 impression (A, D vs VN) ==")
    for k, (n, sh) in SCALES.items():
        cf = tot(results[("D",k)][0]); cfA = tot(results[("A",k)][0]); vn = tot(sh_res[(VN.name,k)][0])
        imps = results[("D",k)][1]["imps"]
        print(f"{k:>5}: CF-A ${cfA/n:.4f}/tb ${cfA/imps*1000:.3f}/1k imp | CF-D ${cf/n:.4f}/tb ${cf/imps*1000:.3f}/1k imp | VN ${vn/n:.4f}/tb ${vn/imps*1000:.3f}/1k imp")
    print("\n== Quet diem giao nhau (VN, gom nhan su) ==")
    for d in ("A","B","C","D"):
        cross = None; prev = None
        n = 50_000
        while n <= 60_000_000:
            sh = max(4, math.ceil(n/6100))
            L, _, _ = cloudflare(n, sh, replace(base, design=d)); R, _ = selfhosted(n, base, VN)
            if tot(R) < tot(L) and cross is None: cross = (n, tot(L), tot(R))
            n = int(n*1.1)
        print(f"design {d}: " + (f"VN re hon CF tu ~{cross[0]/1e6:.2f}M thiet bi (CF ${fmt(cross[1])} vs VN ${fmt(cross[2])})" if cross else "khong giao nhau <= 60M"))
    print("\n== Mat do tai tren 1 Durable Object (dinh, EST) / Queue ==")
    for k, (n, sh) in SCALES.items():
        print(f"{k:>5}: {n/base.hb_s/sh:,.0f} hb/s/DO (gioi han mem 1,000/s) | design A can >= {math.ceil((n/base.hb_s+n/base.ev_s)/5000)} queue (5,000 msg/s/queue)")
    if a.sens:
        print("\n== Nhay cam tai 10M va 50M: tong CF (design A / D) va VN, USD/thang ==")
        def row(label, **kw):
            out = []
            for k in ("10M","50M"):
                n, sh = SCALES[k]
                q = replace(base, **kw)
                A = tot(cloudflare(n, sh, replace(q, design="A"))[0]); C = tot(cloudflare(n, sh, replace(q, design="D"))[0]); V = tot(selfhosted(n, q, VN)[0])
                out.append(f"{k}: A {fmt(A):>9} D {fmt(C):>9} VN {fmt(V):>8}")
            print(f"{label:<44}" + " | ".join(out))
        row("co so (hb120/ev600/mf900/8h)")
        for h in (30, 60, 300, 600): row(f"heartbeat {h}s", hb_s=h)
        for e in (300, 1200, 1800): row(f"gop lo su kien {e}s", ev_s=e)
        for m in (900, 3600): row(f"poll manifest {m}s", mf_s=m)
        for oh in (4, 12, 24): row(f"online {oh} gio/ngay", online_h=oh)
        row("thich ung: hb 300s, ev 1800s, mf 3600s", hb_s=300, ev_s=1800, mf_s=3600)
        row("CPU/req x2", cpu_hb_ms=4, cpu_ev_ms=10, cpu_mf_ms=2)
        row("CPU/req x0.5", cpu_hb_ms=1, cpu_ev_ms=2.5, cpu_mf_ms=0.5)
        # KV ghi presence (khong khuyen nghi)
        for k in ("1M","10M","50M"):
            n, sh = SCALES[k]; v = volumes(n, base)
            print(f"KV-ghi-presence (phan khuyen nghi) {k}: {fmt(over(v['hb'], CF['kv_write_incl'], CF['kv_write_per_m']))} USD/thang chi rieng ghi KV")
        for k in ("1M","10M","50M"):
            n, sh = SCALES[k]; v = volumes(n, base)
            print(f"Analytics Engine ghi moi heartbeat {k}: {fmt(over(v['hb'], 10e6, CF['ae_per_m_points']))} USD/thang (neu bat tinh phi)")
if __name__ == "__main__":
    main()
