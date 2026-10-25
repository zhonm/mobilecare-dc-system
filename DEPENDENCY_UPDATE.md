# Dependency Update

Run these commands from the project folder:

```bash
cd /Users/zhonmns/Documents/mobilecare-dc-system
```

## 1. Create a branch

```bash
git switch -c chore/update-dependencies
```

## 2. Install current dependencies

```bash
npm ci
```

## 3. Check available updates

```bash
npm outdated
```

## 4. Update safe minor and patch versions

```bash
npm update
```

Keep ExcelJS on version 4:

```bash
npm install exceljs@^4.4.0
```

## 5. Check security issues

```bash
npm audit
npm audit fix
npm audit
```

Do **not** run this without testing first:

```bash
npm audit fix --force
```

It can downgrade ExcelJS and introduce more vulnerable packages.

The current `xlsx` warning has no npm fix. Do not replace `xlsx` automatically.

## 6. Test the application

```bash
npm run lint
npm run build
npm test
```

Also manually test:

- Login
- Dashboard
- Spreadsheet import
- Forecasting
- Allocation
- Scan-in and scan-out
- Shipments
- Excel/PDF exports

## 7. Review changes

```bash
git status
git diff -- package.json package-lock.json
```

## 8. Commit if everything passes

```bash
git add package.json package-lock.json
git commit -m "chore: update npm dependencies

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## If something breaks

If the update is not committed:

```bash
git restore package.json package-lock.json
npm ci
```
