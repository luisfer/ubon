class AdminController < ApplicationController
  def backup
    # Command injection risk
    system("tar -czf /tmp/backup.tar.gz #{params[:dir]}")
    render json: { ok: true }
  end
end
