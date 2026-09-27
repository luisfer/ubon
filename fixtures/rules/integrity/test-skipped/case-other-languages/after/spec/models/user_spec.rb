require "rails_helper"

RSpec.describe User do
  xit "validates email" do # expect-block: integrity/test-skipped
    expect(User.new(email: "x").valid?).to be false
  end

  it "has a name" do
    # ok: skip with a trailing condition only skips on CI
    skip "needs the name service" if ENV["CI"]
    expect(User.new(name: "a").name).to eq "a"
  end
end
