class HerdrSplitAgent < Formula
  desc "Herdr mod that shows a running agent next to the current pane without restarting it"
  homepage "https://github.com/kgyujin/herdr-split-agent"
  url "https://github.com/kgyujin/herdr-split-agent/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "94597ac543eff2b86eac838799bfa3fd8d2b8e84149fcc12d0ec669b5a7d40be"
  license "MIT"

  def install
    bin.install "bin/herdr-split-agent"
    pkgshare.install "mods", "VERSION"
  end

  def caveats
    <<~EOS
      Install the mod into the Herdr app with:
        herdr-split-agent install
      Remove it first with `herdr-split-agent uninstall` before `brew uninstall`.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/herdr-split-agent version")
  end
end
