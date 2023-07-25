@echo off

:: download and unpack installer
curl.exe --output %TEMP%\webimage.exe --url %1 --retry 5 --retry-delay 5
start /b /wait %TEMP%\webimage.exe -s -x -f %TEMP%\webimage_extracted --log %TEMP%\extract.log
del %TEMP%\webimage.exe

:: run installer
%TEMP%\webimage_extracted\bootstrapper.exe -s --action install --components=intel.oneapi.win.cpp-compiler:intel.oneapi.win.ifort-compiler --eula=accept -p=NEED_VS2017_INTEGRATION=0 -p=NEED_VS2019_INTEGRATION=0 -p=NEED_VS2022_INTEGRATION=0 --log-dir=%TEMP%
