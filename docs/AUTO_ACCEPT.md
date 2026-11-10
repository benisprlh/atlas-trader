# Auto-accept transaksi: rancangan implementasi

Riset diperiksa 6 November 2026. Dokumen ini adalah rancangan teknis, bukan izin transaksi atau fitur live yang sudah aktif.

Auto-accept dapat dibuat dengan satu persetujuan awal dari pemilik wallet untuk memberikan kewenangan terbatas kepada session account. Setelah itu, executor menandatangani transaksi sesuai kewenangan tersebut tanpa popup untuk setiap trade. MetaMask mendukung alur ini melalui Advanced Permissions, dengan ERC-7715 untuk permintaan izin dan ERC-7710 untuk penggunaan delegasi. Wallet harus mendukung kemampuan tersebut; koneksi wallet biasa tidak memberikan izin trading. [Sumber: panduan eksekusi MetaMask](https://docs.metamask.io/smart-accounts-kit/guides/advanced-permissions/execute-on-metamask-users-behalf/).

## Status Atlas saat ini

| Bagian | Sudah tersedia | Belum tersedia |
| --- | --- | --- |
| Wallet | Pilih provider, hubungkan alamat, baca chain dan saldo | Penandatanganan dan pengiriman transaksi |
| Policy | Validasi dan ekspor draft Base, WETH/USDC, anggaran, masa berlaku | Grant ERC-7715 dan penegakan onchain |
| Runtime | Backtest dan forward paper test | Executor live, session signer, rekonsiliasi transaksi blockchain |
| Kontrol | Pause paper runtime | Pencabutan izin blockchain |

`lib/delegation-policy.ts` menghasilkan `status: "draft"`, `signed: false`, `enforced: false`, dan `liveExecutionEnabled: false`. Menyimpan atau mengekspor draft tidak mengaktifkan auto-accept. Alamat contract pada draft belum diverifikasi sebagai router yang disetujui. Saat ini tidak ada session key atau permission context yang dapat digunakan untuk trading.

## Pilihan arsitektur

| Pendekatan | Kemampuan | Batas keamanan |
| --- | --- | --- |
| Smart account + delegasi terbatas | Session signer mengeksekusi dalam grant yang disetujui pengguna | Batas benar-benar berlaku hanya jika root grant dan contract enforcer menegakkannya |
| Dedicated EOA hot wallet di server | Server dengan owner key dapat menandatangani transaksi tanpa popup | Kontrol di kode aplikasi dapat dilewati jika owner key bocor; wallet tersebut umumnya tidak mempunyai batas harian onchain |
| Wallet browser biasa | Pengguna menyetujui transaksi melalui wallet | Connect wallet atau ERC-20 approval saja tidak menghapus kebutuhan tanda tangan transaksi |

Rekomendasi desain: smart account khusus trading dengan session signer terpisah, bukan owner key pada server. Menyimpan dana lebih sedikit di hot wallet membatasi saldo yang terekspos, tetapi tidak menciptakan policy onchain. Jangan meminta seed phrase/private key wallet utama melalui chat, form aplikasi, localStorage, atau repository. Session signer mendatang harus dioperasikan melalui pengelolaan secret atau signing service yang dipilih pemilik deployment.

## Kemampuan resmi yang dapat dipakai

Dokumentasi terkini menampilkan Smart Accounts Kit **2.0.0**. Tabel jaringan mendukung Advanced Permissions pada **Base (8453)** dan **Base Sepolia (84532)**. Dukungan versi harus dipatok pada dependency dan diperiksa kembali saat integrasi. [Versi toolkit](https://docs.metamask.io/smart-accounts-kit/) · [jaringan](https://docs.metamask.io/smart-accounts-kit/get-started/supported-networks/).

Sebelum menawarkan aktivasi, panggil `getSupportedExecutionPermissions()` dan periksa jenis izin, chain, serta rule yang benar-benar didukung wallet. Setelah pemberian izin, simpan dan validasi respons grant, termasuk `context`, `delegationManager`, chain, grantee, token, batas, dan expiry. Gunakan `getGrantedExecutionPermissions()` untuk menyegarkan informasi grant. Jangan menganggap nilai yang diminta pasti sama dengan nilai yang disetujui pengguna. [Capability discovery](https://docs.metamask.io/smart-accounts-kit/guides/advanced-permissions/get-supported-permissions/) · [daftar grant](https://docs.metamask.io/smart-accounts-kit/guides/advanced-permissions/get-granted-permissions/).

| Izin token | Arti |
| --- | --- |
| `erc20-token-allowance` | Batas total token yang tidak direset per periode |
| `erc20-token-periodic` | Anggaran token yang direset pada periode berikutnya |
| `erc20-token-stream` | Anggaran tersedia bertambah menurut waktu, dengan parameter batas |

Jumlah menggunakan unit token, bukan USD. Untuk anggaran harian, periodic adalah kandidat, bukan bukti bahwa swap sudah aman. Dukungan stable MetaMask untuk periodic/stream mulai 13.23.0; allowance membutuhkan 13.32.1 menurut tabel resmi saat riset. Baris token-approval-revocation mempunyai dukungan toolkit, tetapi kolom versi wallet masih kosong; jangan mengasumsikan tersedia di setiap wallet. [Jenis izin ERC-20](https://docs.metamask.io/smart-accounts-kit/guides/advanced-permissions/use-permissions/erc20-token/) · [matriks versi](https://docs.metamask.io/smart-accounts-kit/get-started/supported-advanced-permissions/).

Session account penerima grant dapat berupa EOA atau smart account. EOA dapat memakai `sendTransactionWithDelegation`; smart account dapat memakai `sendUserOperationWithDelegation` melalui bundler. Trading berjalan dari kewenangan atas smart account pengguna, bukan dengan membagikan owner key. [Panduan session account dan penggunaan izin](https://docs.metamask.io/smart-accounts-kit/guides/advanced-permissions/execute-on-metamask-users-behalf/).

## Batas token belum cukup untuk trading

Berikut keputusan desain Atlas, diturunkan dari perbedaan izin transfer dan pembatasan pemanggilan contract. Batas token saja tidak menjamin router, fungsi swap, penerima hasil, token keluaran, atau harga minimum yang diinginkan.

| Kontrol | Penegakan yang diperlukan sebelum live |
| --- | --- |
| Jaringan dan aset | Chain tetap; alamat token dan decimals diverifikasi, bukan symbol saja |
| Budget | Integer unit token untuk batas per trade/per periode; USD pada UI hanya estimasi kecuali ada desain oracle yang ditinjau |
| Target dan fungsi | Root grant membatasi contract executor/router serta selector yang dibolehkan |
| Penerima dan rute | Hasil hanya kembali ke smart account pemilik; token keluaran dan seluruh jalur transaksi divalidasi |
| Harga eksekusi | `minAmountOut`, deadline, dan sumber quote yang masih berlaku; allowance tidak menegakkan ini sendiri |
| Approval ERC-20 | Spender tetap dan nilai terbatas; tidak ada unlimited approval atau sisa allowance luas yang mengalahkan batas trade |
| Risiko strategi | Drawdown, frekuensi, data usang, dan pause diperiksa executor; jangan diberi label onchain kecuali memang ada enforcer |

Delegation Framework menyediakan scope `FunctionCall` serta caveat seperti allowed targets, allowed methods, calldata restrictions, timestamp, dan perubahan saldo ERC-20. Ini merupakan komponen untuk membangun pembatasan, bukan jaminan bahwa setiap permintaan ERC-7715 token otomatis menerima kombinasi tersebut. Integrasi harus membuktikan kompatibilitas scope, call semantics, dan contract yang digunakan. [Scope](https://docs.metamask.io/smart-accounts-kit/reference/delegation/delegation-scopes/) · [caveat](https://docs.metamask.io/smart-accounts-kit/reference/delegation/caveats/).

Jika izin token yang tersedia terlalu luas untuk swap, pilih grant contract-call yang tepat atau executor contract yang membatasi rute dan hasil. Jangan diam-diam turun ke izin tanpa batas. Subdelegasi yang lebih sempit tidak melindungi dari kebocoran parent key bila executor yang sama tetap menyimpan kewenangan parent yang lebih luas; pembatasan harus berada pada jalur kewenangan yang tidak bisa dilewati signer.

## Expiry, pencabutan, dan gas

Tetapkan expiry eksplisit, tampilkan waktu kedaluwarsa, dan tolak intent baru sebelum expiry. Pengguna dapat mencabut Advanced Permissions melalui menu Permissions MetaMask. Untuk delegasi langsung, toolkit menyediakan encoding `disableDelegation`; membuat calldata saja belum mencabut izin karena transaksi yang benar masih perlu dieksekusi. UI harus membedakan pause executor, disconnect wallet, pencabutan diminta, dan pencabutan terkonfirmasi. Pencabutan tidak membatalkan transaksi yang sudah selesai. [Pengelolaan Advanced Permissions](https://support.metamask.io/more-web3/dapps/advanced-permissions/) · [API disableDelegation](https://docs.metamask.io/smart-accounts-kit/reference/delegation/#disabledelegation).

Gas merupakan anggaran terpisah. Session EOA yang mengirim transaksi membutuhkan sumber pembayaran native gas; jalur smart account menggunakan bundler dan dapat menggunakan paymaster. Sponsorship bersifat pilihan, bukan gas gratis yang dijamin. Tetapkan batas biaya, saldo cadangan, serta perilaku berhenti ketika dana gas atau layanan bundler tidak tersedia. Anggaran WETH/USDC tidak otomatis membatasi biaya gas. [Jalur EOA](https://github.com/MetaMask/smart-accounts-kit/blob/main/skills/smart-accounts-kit/workflows/redeem-permissions-eoa.md) · [jalur smart account](https://github.com/MetaMask/smart-accounts-kit/blob/main/skills/smart-accounts-kit/workflows/redeem-permissions-smart-account.md). Contoh repository harus disesuaikan dengan API versi yang dipatok; contoh lama tidak langsung disalin ke 2.0.0.

## Implementasi berikutnya yang konkret

1. Tambahkan adapter capability/grant dengan versi SDK yang dipatok, dimulai pada Base Sepolia. Gunakan aset uji; draft Base mainnet sekarang bukan konfigurasi testnet.
2. Pilih satu executor dan satu rute swap uji. Tetapkan ABI, deployed bytecode/chain, token, penerima, nilai maksimum, quote deadline, dan cara seluruh batas ditegakkan sebelum menampilkan tombol aktivasi.
3. Pisahkan risk engine deterministik dari signer. LLM hanya memberi analisis; LLM tidak menerima private key, membangun calldata arbitrer, atau mengubah policy.
4. Simpan grant yang benar-benar disetujui, hash intent, nonce, status submission, dan receipt. Gunakan kunci idempotensi, antrean, serta rekonsiliasi setelah restart agar satu sinyal tidak menghasilkan dua transaksi.
5. Uji bahwa amount berlebih, chain/token/recipient/target salah, selector tak diizinkan, quote kedaluwarsa, expiry, dan revocation menolak eksekusi. Uji gas habis, kegagalan bundler, transaksi pending, restart, dan pengiriman ulang. Ini daftar uji yang harus dibuat, bukan klaim uji live sudah dilakukan.
6. Tampilkan preview grant final: siapa signer, aset, batas token, periode reset, expiry, contract/fungsi, sumber gas, dan cara revoke. Pengguna melakukan pemberian izin melalui wallet sendiri. Hanya grant terverifikasi yang boleh menghasilkan status **Active**.

Alur produk yang dituju: **Connect → periksa dukungan → review batas → pengguna memberi izin sekali → auto-execution dalam scope → expiry atau revoke**. Saat ini Atlas berhenti pada koneksi dan penyusunan draft; auto-accept belum aktif.
