require "rails_helper"

RSpec.describe User do
  it "validates email" do
    expect(User.new(email: "x").valid?).to be false
  end

  it "has a name" do
    expect(User.new(name: "a").name).to eq "a"
  end
end
