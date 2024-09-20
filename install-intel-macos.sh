install_mkl=$1
MACOS_URL=$2
if [ "$MACOS_URL" == "" ]; then
  echo "ERROR: MACOS URL is empty - please check the version mapping for mkl/intel compiler"
  echo "SKIPPING MKL/intel installation..."
elif [ "$MACOS_URL" == "2021.5" ] and $install_mkl; then
  echo "ERROR: MKL not available for this intel compiler version"
  echo "SKIPPING MKL installation..."
else
  require_fetch
  $fetch $MACOS_URL > m_BASE_HPC_Kit.dmg
  hdiutil verify m_BASE_HPC_Kit.dmg
  hdiutil attach m_BASE_HPC_Kit.dmg
  sudo /Volumes/"$(basename "$MACOS_URL" .dmg)"/bootstrapper.app/Contents/MacOS/bootstrapper -s \
    --action install \
    --eula=accept \
    --continue-with-optional-error=yes \
    --log-dir=.
  hdiutil detach /Volumes/"$(basename "$MACOS_URL" .dmg)" -quiet
  rm m_BASE_HPC_Kit.dmg
fi