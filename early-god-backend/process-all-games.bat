@echo off
echo Processing all game datasets for Vertex AI...

REM -- Game 1: Expedition 33 --
echo.
echo =================================
echo   Processing: expedition33
echo =================================
node scripts/convert-jsonl-to-vertex.js expedition33

REM -- Game 2: Ghost of Yotei --
echo.
echo =====================================
echo   Processing: ghost_of_yotei_dataset
echo =====================================
node scripts/convert-jsonl-to-vertex.js ghost_of_yotei_dataset

echo.
echo ============================
echo   All games processed!
echo ============================
