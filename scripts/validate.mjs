#!/usr/bin/env node
// Validasi file klaim di pull request. Dipakai workflow validate-pr.yml.
// Keluar: exit 1 kalau ada file salah, dan mencetak ringkasan untuk komentar bot.

import { execSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.argv[2]; // contoh: origin/main
const ZONE = "sang.ceo";

const changedAll = execSync(`git diff --name-only --diff-filter=ACM ${BASE}...HEAD`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

// JSON di luar data/ adalah kesalahan penempatan yang paling sering terjadi.
// Jangan dibisukan: beri tahu pembuka PR agar tidak mengulangi kesalahan yang sama.
const misplaced = changedAll.filter((f) => f.endsWith(".json") && !f.startsWith("data/"));
const changed = changedAll.filter((f) => f.startsWith("data/") && f.endsWith(".json"));

const NAME_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.([a-z0-9]([a-z0-9-]*[a-z0-9])?))*$/;
const EMAIL_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
const ADDR_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Nama yang sudah ada di main, untuk cek duplikat lintas file.
const existing = {
  sub: new Set(
    execSync(`git ls-tree -r --name-only ${BASE} -- data/domains`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((f) => f.split("/").pop().replace(`.${ZONE}.json`, "").replace(".json", ""))
  ),
  mail: new Set(
    execSync(`git ls-tree -r --name-only ${BASE} -- data/emails`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((f) => f.split("/").pop().replace(".json", ""))
  ),
};

const errors = [];
const previews = [];
const notes = [];

for (const file of misplaced) {
  errors.push(
    `\`${file}\`: posisi file salah. File klaim harus di \`data/domains/<nama>.${ZONE}.json\` atau \`data/emails/<alamat>.json\`. Paling mudah: buat ulang lewat generator di https://${ZONE}/daftar`
  );
}

// Sensor utk tampilan: nama -> ja••••el; nilai record: label penyedia tetap terlihat.
function censorMiddle(s) {
  if (s.length <= 3) return s[0] + "•" + (s.length > 2 ? s[s.length - 1] : "");
  return s.slice(0, 2) + "•".repeat(s.length - 4) + s.slice(-2);
}
function maskName(name) {
  return censorMiddle(String(name).trim());
}
function maskRecord(value) {
  const v = String(value).trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    const o = v.split(".");
    return `${o[0]}.•••.•••.${o[3]}`;
  }
  const labels = v.split(".");
  if (labels.length <= 2) return censorMiddle(v);
  return censorMiddle(labels[0]) + "." + labels.slice(1).join(".");
}

for (const file of changed) {
  const rel = file;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(rel, "utf8"));
  } catch (e) {
    errors.push(`\`${rel}\`: bukan JSON valid (${e.message})`);
    continue;
  }

  if (rel.startsWith("data/domains/")) {
    const { domain, subdomain, owner, records, extra } = data;
    if (domain !== ZONE) errors.push(`\`${rel}\`: \`domain\` harus \`${ZONE}\``);
    if (!subdomain || !NAME_RE.test(subdomain))
      errors.push(`\`${rel}\`: \`subdomain\` tidak valid (huruf kecil, angka, tanda hubung)`);
    if (!owner) errors.push(`\`${rel}\`: \`owner\` (username GitHub) wajib`);
    if (!records || typeof records !== "object" || Object.keys(records).length === 0)
      errors.push(`\`${rel}\`: \`records\` wajib berisi minimal satu record`);
    // Pagar tipe record. Generator DNS (gen-dnsconfig.mjs) hanya memetakan tipe di
    // daftar ini. Tipe di luar daftar akan LOLOS validator tetapi DIABAIKAN oleh
    // generator, jadi recordnya tidak pernah sampai ke DNS. Lebih baik ditolak di
    // sini dengan pesan jelas daripada pemiliknya menunggu record yang tidak ada.
    const TIPE_DIDUKUNG = ["A", "AAAA", "CAA", "CNAME", "SRV", "TXT"];
    // Dua tipe ini sengaja tidak dipakai, dan alasannya beda dari tipe tak dikenal.
    const TIPE_DILARANG = { MX: "MX mengarahkan surat masuk, salah isi bisa membelokkan surat orang", NS: "NS bisa mengambil alih seluruh zona" };
    for (const tipe of Object.keys(records || {})) {
      if (TIPE_DILARANG[tipe]) {
        errors.push(`\`${rel}\`: tipe \`${tipe}\` tidak dipakai di registry ini. ${TIPE_DILARANG[tipe]}.`);
        continue;
      }
      if (!TIPE_DIDUKUNG.includes(tipe))
        errors.push(
          `\`${rel}\`: tipe record \`${tipe}\` belum dipetakan generator DNS, jadi tidak akan pernah aktif. ` +
            `Tipe yang didukung: ${TIPE_DIDUKUNG.join(", ")}.`
        );
    }
    // CNAME harus satu-satunya record pada namanya, aturan DNS.
    if (records?.CNAME && Object.keys(records).length > 1)
      errors.push(`\`${rel}\`: \`CNAME\` harus satu-satunya record. Hapus tipe lain, atau ganti CNAME menjadi A/AAAA.`);
    if (subdomain && existing.sub.has(subdomain) && !rel.endsWith(`/${subdomain}.${ZONE}.json`))
      errors.push(`\`${rel}\`: subdomain \`${subdomain}\` sudah diklaim orang lain`);
    if (subdomain && records?.CNAME && NAME_RE.test(subdomain)) {
      if (typeof records.CNAME !== "string")
        errors.push(`\`${rel}\`: CNAME harus berupa string tunggal`);
      if (String(records.CNAME).toLowerCase().startsWith(`${subdomain}.${ZONE}`))
        errors.push(`\`${rel}\`: CNAME tidak boleh menunjuk ke namanya sendiri`);
    }
    if (data.proxy !== undefined && typeof data.proxy !== "boolean")
      errors.push(`\`${rel}\`: \`proxy\` harus true atau false`);
    // record tambahan untuk verifikasi penyedia hosting (Vercel, GitHub Pages, Netlify, dsb).
    // Namanya label relatif di bawah subdomain sendiri, mis. "_vercel" -> _vercel.elkaff.sang.ceo
    if (extra !== undefined) {
      if (!Array.isArray(extra) || extra.length > 10) {
        errors.push(`\`${rel}\`: \`extra\` harus berupa array maksimal 10 record`);
      } else {
        const LABEL_RE = /^_?[a-z0-9][a-z0-9-]{0,62}$/;
        extra.forEach((x, i) => {
          const at = `\`${rel}\`: \`extra[${i}]\``;
          if (!x || typeof x !== "object") return errors.push(`${at} harus objek {type,name,value}`);
          if (x.type !== "TXT")
            errors.push(`${at}: hanya \`type: "TXT"\` yang didukung untuk verifikasi`);
          if (!x.name || !LABEL_RE.test(x.name))
            errors.push(`${at}: \`name\` harus satu label huruf kecil/angka/tanda hubung, boleh diawali \`_\``);
          if (typeof x.value !== "string" || x.value.length === 0 || x.value.length > 500 || /[\r\n]/.test(x.value))
            errors.push(`${at}: \`value\` harus string 1-500 karakter tanpa baris baru`);
          // Vercel punya dua alur. Kalau subdomain masih di akun Vercel sendiri, TXT
          // diletakkan di bawah subdomain. Kalau tertaut ke akun Vercel lain, Vercel
          // meminta record di level zona, dan itu harus ditulis `at: "apex"`.
          if (x.at !== "apex" && /^vc-domain-verify=[a-z0-9.-]+,[a-z0-9]+$/i.test(String(x.value))) {
            notes.push(
              `${at}: record ini diletakkan di \`${x.name}.${subdomain}.${ZONE}\`. ` +
                `Vercel meminta dua tempat berbeda: kalau dashboard menulis "This domain is linked to another Vercel account" ` +
                `dan menampilkan \`_vercel.${ZONE}\`, recordnya harus di level zona dengan menambahkan \`"at": "apex"\`. ` +
                `Gantilah entri yang ada (bukan menambah entri kedua): ` +
                `\`{ "type": "TXT", "name": "${x.name}", "at": "apex", "value": "${x.value}" }\`.`
            );
          }
          if (x.at === "apex") {
            // Record level zona hanya untuk verifikasi kepemilikan subdomain lewat Vercel.
            // Tanpa batas ini, siapa pun bisa memverifikasi kepemilikan zona sang.ceo itu sendiri.
            if (x.name !== "_vercel")
              errors.push(`${at}: \`at: "apex"\` hanya untuk \`name: "_vercel"\``);
            if (!/^vc-domain-verify=[a-z0-9.-]+,[a-z0-9]+$/i.test(String(x.value)))
              errors.push(`${at}: nilai level zona harus format Vercel \`vc-domain-verify=<domain>,<kode>\``);
            if (/^vc-domain-verify=sang\.ceo,/i.test(String(x.value)))
              errors.push(`${at}: nilai tidak boleh memverifikasi zona sang.ceo itu sendiri`);
          } else if (x.at !== undefined && x.at !== "sub") {
            errors.push(`${at}: \`at\` hanya boleh "sub" (default) atau "apex"`);
          }
        });
      }
    }
    if (!errors.some((e) => e.startsWith(`\`${rel}\``))) {
      const rec = Object.entries(records || {})
        .map(([t, v]) => `${t} ${Array.isArray(v) ? v.map((x) => maskRecord(String(x))).join(", ") : maskRecord(String(v))}`)
        .join(" · ");
      previews.push(`| \`${maskName(subdomain)}.${ZONE}\` | ${maskName(owner)} | ${data.description || "-"} | ${rec} |`);
    }
  } else if (rel.startsWith("data/emails/")) {
    const { domain, address, owner, type, contact, password } = data;
    if (password)
      errors.push(`\`${rel}\`: JANGAN taruh password di file. Sandi dikirim otomatis ke email akun GitHub yang membuka PR`);
    if (domain !== ZONE) errors.push(`\`${rel}\`: \`domain\` harus \`${ZONE}\``);
    if (!address || !EMAIL_RE.test(address))
      errors.push(`\`${rel}\`: \`address\` tidak valid (huruf kecil, angka, titik, tanda hubung)`);
    if (!owner) errors.push(`\`${rel}\`: \`owner\` (username GitHub) wajib`);
    if (type && type !== "mailbox")
      errors.push(`\`${rel}\`: hanya \`type: "mailbox"\` yang didukung`);
    if (contact && !ADDR_RE.test(contact))
      errors.push(`\`${rel}\`: \`contact\` harus alamat email yang valid`);
    if (address && existing.mail.has(address) && !rel.endsWith(`/${address}.json`))
      errors.push(`\`${rel}\`: alamat \`${address}\` sudah diklaim orang lain`);
    // Tanpa `contact`, pelacakan penerima sandi bergantung pada akun GitHub pengklaim.
    // Kalau itu gagal, sandi tidak dikirim ke siapa pun, jadi pemilik perlu tahu lebih awal.
    if (rel.endsWith(`/${address}.json`) && !contact) {
      notes.push(
        `\`${rel}\`: belum ada \`contact\`. Sandi mailbox akan dicoba dikirim ke email akun GitHub \`${owner}\`, ` +
          `dan pengirimannya **dibatalkan** bila alamat itu tidak bisa dipastikan. ` +
          `Tambahkan \`"contact": "email-kamu@contoh.com"\` supaya sandi pasti sampai ke kamu.`
      );
    }
    if (!errors.some((e) => e.startsWith(`\`${rel}\``))) {
      previews.push(
        `| \`${maskName(address)}@${ZONE}\` | ${maskName(owner)} | mailbox, sandi ke ${contact ? "email contact" : "email akun GitHub"} |`
      );
    }
  }
}

// Satu pemilik boleh memegang paling banyak 3 subdomain. Dihitung dari seluruh
// isi data/domains pada keadaan PR ini, bukan hanya berkas yang berubah, supaya
// PR berisi beberapa berkas tidak bisa dipakai melewati batas.
const BATAS_SUBDOMAIN = 3;
{
  const bacaIsi = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(rel, "utf8"));
    } catch {
      return null;
    }
  };

  // Pemilik yang berkasnya ikut di PR ini. Hanya mereka yang diperiksa, supaya
  // PR orang lain tidak ikut ditutup gara-gara ada akun yang sudah lewat batas
  // sebelum aturan ini ada.
  const terlibat = new Set();
  for (const rel of changed.filter((f) => f.startsWith("data/domains/"))) {
    const isi = bacaIsi(rel);
    const siapa = String(isi?.owner || "").toLowerCase();
    if (siapa) terlibat.add(siapa);
  }

  const milik = new Map();
  let semua = [];
  try {
    semua = fs.readdirSync("data/domains").filter((f) => f.endsWith(".json"));
  } catch {
    semua = [];
  }
  for (const nama of semua) {
    const isi = bacaIsi(`data/domains/${nama}`);
    if (!isi) continue;
    const siapa = String(isi.owner || "").toLowerCase();
    if (!siapa || siapa === "unknown") continue;
    if (!milik.has(siapa)) milik.set(siapa, []);
    milik.get(siapa).push(isi.subdomain || nama);
  }

  for (const siapa of terlibat) {
    const daftar = milik.get(siapa) || [];
    if (daftar.length > BATAS_SUBDOMAIN)
      errors.push(
        `Akun \`${siapa}\` memegang ${daftar.length} subdomain (${daftar
          .map((n) => `\`${n}\``)
          .join(", ")}), sedangkan batasnya ${BATAS_SUBDOMAIN} per akun. Lepaskan salah satunya lewat https://${ZONE}/kelola, lalu kirim PR ini lagi.`
      );
  }
}

if (previews.length > 0) {
  const isMail = previews[0].includes("@");
  console.log(
    isMail
      ? "### Pratinjau klaim email\n\n| Alamat | Pemilik | Jenis |\n|---|---|---|\n" +
          previews.join("\n")
      : "### Pratinjau klaim subdomain\n\n| Subdomain | Pemilik | Deskripsi | Record |\n|---|---|---|---|\n" +
          previews.join("\n")
  );
}

if (notes.length > 0) {
  console.log("### Catatan\n\n" + notes.map((n) => `- ${n}`).join("\n"));
}

if (changed.length === 0 && misplaced.length === 0) {
  console.log(
    `Tidak ada file klaim dalam PR ini. Klaim diletakkan di \`data/domains/\` atau \`data/emails/\` — generator: https://${ZONE}/daftar`
  );
}

if (errors.length > 0) {
  console.error("### Perlu diperbaiki\n\n" + errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.log("Semua file klaim lolos validasi.");
