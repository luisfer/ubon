class User < ApplicationRecord
  def self.find_by_name(name)
    # SQLi via interpolation
    where("name = '#{name}'").first
  end

  def self.by_sql_fragment(fragment)
    # SQLi via find_by_sql with interpolation
    find_by_sql(["SELECT * FROM users WHERE note LIKE '%#{fragment}%' "])
  end
end
