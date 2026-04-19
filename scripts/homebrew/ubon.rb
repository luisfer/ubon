################################################################################
# Homebrew formula template for `ubon`.
#
# Lives in this repo as documentation; the real formula is published to
# https://github.com/luisfer/homebrew-tap (so users get `brew install
# luisfer/tap/ubon`). The release workflow updates the SHA + url after each
# tag — keep this template in sync with that workflow.
################################################################################

class Ubon < Formula
  desc "Security scanner for AI-generated apps (Cursor, Lovable, Windsurf, v0)"
  homepage "https://github.com/luisfer/ubon"
  url "https://registry.npmjs.org/ubon/-/ubon-3.0.0.tgz"
  sha256 "REPLACE_ME_AT_RELEASE_TIME"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]

    generate_completions_from_executable(bin/"ubon", "completion")
  end

  test do
    assert_match "3.0.0", shell_output("#{bin}/ubon --version")
  end
end
