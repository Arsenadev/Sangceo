# Cara klaim

Satu klaim = satu file JSON = satu pull request. Jangan menaruh password atau data
pribadi di file mana pun: repo ini publik.

## Subdomain

Buat `data/domains/<nama>.sang.ceo.json`:

```json
{
  "domain": "sang.ceo",
  "subdomain": "nama",
  "owner": "username-github-mu",
  "records": { "CNAME": "cname.vercel-dns.com" }
}
```

- `subdomain`: huruf kecil, angka, tanda hubung. Boleh bertingkat (`app.nama`).
- `records`: minimal satu record. Tipe yang didukung: CNAME, A, AAAA, TXT, MX, NS, SRV, CAA, PTR.
- Untuk A/AAAA, isi IP. Untuk record lain, isi target FQDN.
- Tidak ada record A/AAAA ke IP privat atau loopback.

## Mailbox

Buat `data/emails/<alamat>.json`:

```json
{
  "domain": "sang.ceo",
  "address": "nama",
  "type": "mailbox",
  "owner": "username-github-mu"
}
```

Setelah PR merge, akun dibuat otomatis dan sandi awal dikirim ke **email akun GitHub
yang membuka PR** (email publik di profil; bila tidak ada, email author commit).
Alamat `@users.noreply.github.com` tidak bisa menerima surel, jadi pastikan salah
satunya asli. Jatah mailbox gratis terbatas 3 akun untuk seluruh zona.

## Aturan singkat

1. Satu subdomain / alamat per orang per keperluan. Tidak ada penimbunan.
2. Jangan klaim nama milik orang lain atau merek dagang pihak lain.
3. Konten ilegal (phishing, malware, penipuan) dihapus tanpa pemberitahuan.
4. Bot menutup otomatis PR yang filenya salah format.
