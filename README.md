# sang.ceo registry

Repo ini adalah **database** dari [sang.ceo](https://sang.ceo): daftar subdomain dan mailbox yang sudah diklaim.

- Halaman publik: <https://sang.ceo>
- Aturan klaim: lihat [CONTRIBUTING.md](./CONTRIBUTING.md)
- Tanpa kode situs, tanpa kredensial. Hanya data klaim dan bot validasi.

## Struktur

```
data/domains/<nama>.sang.ceo.json   # satu subdomain per file
data/emails/<alamat>.json           # satu mailbox per file
scripts/validate.mjs                # validator yang dipakai bot
.github/workflows/validate-pr.yml   # bot: komentar pratinjau, tolak otomatis kalau salah
```

## Alur

1. Tambah satu file JSON lewat pull request (atau pakai generator di situs).
2. Bot memvalidasi dan berkomentar pratinjau. Kalau salah, PR ditutup otomatis.
3. Setelah merge, pengelola menjalankan sinkronisasi: record DNS dibuat dan mailbox
   diprovision otomatis, sandi dikirim ke email akun GitHub pembuka PR.
