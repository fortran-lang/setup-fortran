MACOS_BASEKIT_URL=$1

if [ "$MACOS_BASEKIT_URL" == "" ]; then
  echo "ERROR: MACOS_BASEKIT_URL is empty - please check the version mapping for MKL"
  echo "SKIPPING MKL installation..."
elif [ "$MACOS_BASEKIT_URL" == "2021.5" ]; then
  echo "ERROR: MKL not available for this intel compiler version"
  echo "SKIPPING MKL installation..."
else
  require_fetch
  $fetch $MACOS_BASEKIT_URL > m_BASEKit.dmg
  ls -lh
  hdiutil verify m_BASEKit.dmg
  hdiutil attach m_BASEKit.dmg
  sudo /Volumes/"$(basename "$MACOS_BASEKIT_URL" .dmg)"/bootstrapper.app/Contents/MacOS/bootstrapper -s \
    --action install \
    --eula=accept \
    --continue-with-optional-error=yes \
    --log-dir=.
  hdiutil detach /Volumes/"$(basename "$MACOS_BASEKIT_URL" .dmg)" -quiet
  rm m_BASEKit.dmg
fi